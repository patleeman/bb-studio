// Strands in Studio's server: BB's thread events drive the detector, the
// backfill runs once per conversation a little after start, and the
// strands.* RPCs and `bb studio strands` read it.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { STUDIO_REALTIME_CHANNEL } from "../kit/contract";
import { primaryHostId } from "../kit/server/project";
import { runStrandsCli } from "./cli";
import { rpcContract } from "./contract";
import { EVENT_TYPES, type EventRow } from "./turns";
import { STRANDS_CALLER } from "./detector";
import { StrandService, type WorkerFact } from "./service";
import { StrandStore } from "./store";
import type { Interaction } from "../worker-approvals";

type Failure = { ok: false; unavailable: boolean; error: string };
export interface StrandsDecisions {
  systemOne(input: { caller: string; state: unknown; questions: never }, signal?: AbortSignal): Promise<{ ok: true; answers: Record<string, unknown> } | Failure>;
  model(input: { caller: string; requestId: string; hostId: string; prompt: string; providerId: string | null }, signal?: AbortSignal): Promise<{ ok: true; text: string | null } | Failure>;
}

export interface StrandsRegisterDeps {
  decisions: StrandsDecisions;
  /** Each Bot's Main thread. */
  mains(): string[];
  workers(threadId: string): Promise<WorkerFact[]>;
  log(message: string): void;
}

/** Backfill this long after Studio starts, so start-up work goes first. */
const BACKFILL_DELAY_MS = 90_000;
const BUSY = new Set(["active", "pending", "starting", "stopping"]);

export function registerStrands(bb: BbPluginApi, db: Database.Database, deps: StrandsRegisterDeps): { service: StrandService | null; cli(argv: readonly string[], ctx: { threadId?: string | null }): Promise<{ exitCode: number; stdout?: string; stderr?: string }> } {
  if (!StrandStore.ready(db)) {
    deps.log("Strands: the strands tables are missing; strands are off.");
    return { service: null, cli: async () => ({ exitCode: 1, stderr: "Strands aren't available: Studio's database has no strands tables.\n" }) };
  }
  let disposed = false;
  let signal: ReturnType<typeof setTimeout> | null = null;
  const changed = () => {
    if (disposed || signal) return;
    signal = setTimeout(() => { signal = null; void bb.realtime.publish(STUDIO_REALTIME_CHANNEL, { pluginId: "studio" } as never); }, 250);
  };
  const threadOf = async (threadId: string) => await bb.sdk.threads.get({ threadId }).catch(() => null) as { status?: string; providerId?: string | null } | null;
  const service = new StrandService({
    db,
    conversations: deps.mains,
    events: async ({ threadId, afterSeq, beforeSeq, order, limit }) => await bb.sdk.threads.events.list({
      threadId, order, limit: String(limit), types: [...EVENT_TYPES],
      ...(afterSeq !== undefined ? { afterSeq: String(afterSeq) } : {}), ...(beforeSeq !== undefined ? { beforeSeq: String(beforeSeq) } : {}),
    } as never) as unknown as EventRow[],
    jev: (input) => deps.decisions.systemOne({ ...input, questions: input.questions as never }),
    model: async ({ threadId, requestId, prompt }) => {
      const hostId = await primaryHostId(bb).catch(() => null);
      if (!hostId) return { ok: false, unavailable: true, error: "BB has no primary host to run the model on." };
      // In Decisions' "thread" mode the model follows the conversation's provider.
      const providerId = (await threadOf(threadId))?.providerId ?? null;
      return deps.decisions.model({ caller: STRANDS_CALLER, requestId, hostId, prompt, providerId });
    },
    workers: deps.workers,
    interactions: async (threadId) => {
      const list = await bb.sdk.threads.interactions.list({ threadId }) as unknown as (Interaction & { createdAt?: number })[];
      return list.filter((each) => each.status === undefined || each.status === "pending");
    },
    busy: async (threadId) => BUSY.has((await threadOf(threadId))?.status ?? ""),
    changed,
    log: deps.log,
  });
  const run = (what: string, job: () => Promise<unknown> | void) => { try { void Promise.resolve(job()).catch((error) => deps.log(`Strands ${what}: ${error instanceof Error ? error.message : String(error)}`)); } catch (error) { deps.log(`Strands ${what}: ${String(error)}`); } };
  bb.events.on("thread.idle", ({ thread }) => run("sort", () => service.idle(thread.id)));
  bb.events.on("thread.failed", ({ thread }) => run("sort", () => service.idle(thread.id)));
  bb.events.on("thread.active", ({ thread }) => run("early sort", () => service.active(thread.id)));
  bb.events.on("interaction.pending", ({ thread }) => run("early sort", () => service.asked(thread.id)));
  bb.events.on("thread.deleted", ({ thread }) => run("forget", () => service.forget(thread.id)));
  const backfill = setTimeout(() => run("backfill", () => service.backfillAll()), BACKFILL_DELAY_MS);
  bb.onDispose(() => { disposed = true; clearTimeout(backfill); if (signal) clearTimeout(signal); service.dispose(); });

  bb.rpc.register(rpcContract, {
    "strands.list": ({ threadId }) => service.list(threadId),
    "strands.items": ({ threadId, limit }) => ({ items: service.items(threadId, limit ?? 200) }),
    "strands.tags": ({ threadId }) => service.tags(threadId),
    "strands.opened": ({ strandId }) => ({ ok: service.opened(strandId) }),
  });

  const cli = (argv: readonly string[], ctx: { threadId?: string | null }) => runStrandsCli(argv, {
    resolve: async (ref) => {
      const mains = deps.mains();
      if (ref && ref !== "main") return ref.replace(/^@?thread:/, "");
      // The caller's own conversation when strands run there, else the first Bot's Main.
      if (!ref && ctx.threadId && mains.includes(ctx.threadId)) return ctx.threadId;
      return mains[0] ?? null;
    },
    list: (threadId) => service.list(threadId),
    items: (threadId, limit) => service.items(threadId, limit),
    sort: (threadId) => service.idle(threadId),
  });
  return { service, cli };
}
