// Strands in Studio's server: BB's thread events drive the detector, the
// backfill runs once per conversation a little after start, and the
// strands.* RPCs and `bb studio strands` read it.
import { experimental_PluginRpcRefusal, type BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { STUDIO_REALTIME_CHANNEL } from "../kit/contract";
import { primaryHostId } from "../kit/server/project";
import { runStrandsCli, strandsThreadFor, type StrandsScope } from "./cli";
import { rpcContract, STRAND_NOTE_DESCRIPTION, STRAND_NOTE_TOOL, strandNoteInput, type StrandNoteInput } from "./contract";
import { EVENT_TYPES, type EventRow } from "./turns";
import { JEV_TIMEOUT_MS, STRANDS_CALLER } from "./detector";
import { StrandService, type WorkerFact } from "./service";
import { StrandStore } from "./store";
import { isAppWindow } from "../tool-gateway/server/caller";
import type { Interaction } from "../worker-approvals";

type Failure = { ok: false; unavailable: boolean; error: string };
export interface StrandsDecisions {
  systemOne(input: { caller: string; state: unknown; questions: never }, signal?: AbortSignal): Promise<{ ok: true; answers: Record<string, unknown> } | Failure>;
  model(input: { caller: string; requestId: string; hostId: string; prompt: string; providerId: string | null }, signal?: AbortSignal): Promise<{ ok: true; text: string | null } | Failure>;
}

export interface StrandsRegisterDeps {
  decisions: StrandsDecisions;
  /** A conversation strands run in (a Bot's, Main included; not a worker, not archived): its Bot and last activity. */
  conversation(threadId: string): { botId: string; lastActiveAt: number } | null;
  /** A Bot's conversations, for the overview. */
  conversationsOf(botId: string): Promise<{ threadId: string; title: string; isMain: boolean; lastActiveAt: number }[]>;
  workers(threadId: string): Promise<WorkerFact[]>;
  /** Who may see which conversation's strands from `bb studio strands`. */
  scope: Omit<StrandsScope, "enabled">;
  /** A worker's conversation, for strand_note from a worker. */
  conversationOfWorker?(threadId: string): string | null;
  /** An area's item that needs the user, and the conversation's own flag; see StrandServiceDeps.extraAsks. */
  extraAsks?(threadId: string): { id: string; kind: "area" | "flag"; label: string; at: number }[];
  /** Secret values to keep out of what strands send and keep: Studio's API keys, Tool Gateway's secrets. */
  secrets(): Promise<readonly string[]>;
  /** The Studio setting strands_richSorting. */
  richSorting?(): boolean;
  log(message: string): void;
}

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
  // BB's one-line model call (desktop 1.0.11): naming and summaries use it when this BB has it.
  const hooks = (bb as { experimental_hooks?: { experimental_completeText?: (request: { prompt: string; timeoutMs?: number; signal?: AbortSignal }) => Promise<{ ok: true; text: string } | { ok: false; reason?: string; message?: string }> } }).experimental_hooks;
  const completeText = typeof hooks?.experimental_completeText === "function" ? hooks.experimental_completeText.bind(hooks) : null;
  const threadOf = async (threadId: string) => await bb.sdk.threads.get({ threadId }).catch(() => null) as { status?: string; providerId?: string | null } | null;
  const service = new StrandService({
    db,
    conversation: deps.conversation,
    conversationsOf: deps.conversationsOf,
    events: async ({ threadId, afterSeq, beforeSeq, order, limit, types }) => await bb.sdk.threads.events.list({
      threadId, order, limit: String(limit), types: [...(types ?? EVENT_TYPES)],
      ...(afterSeq !== undefined ? { afterSeq: String(afterSeq) } : {}), ...(beforeSeq !== undefined ? { beforeSeq: String(beforeSeq) } : {}),
    } as never) as unknown as EventRow[],
    jev: (input) => deps.decisions.systemOne({ ...input, questions: input.questions as never }, AbortSignal.timeout(JEV_TIMEOUT_MS)),
    secrets: deps.secrets,
    richSorting: deps.richSorting,
    ...(completeText ? {
      completeText: async ({ prompt, signal }: { prompt: string; signal?: AbortSignal }) => {
        const result = await completeText({ prompt, timeoutMs: 8_000, ...(signal ? { signal } : {}) });
        return result.ok ? { ok: true as const, text: result.text } : { ok: false as const, error: result.message ?? result.reason ?? "no answer" };
      },
    } : {}),
    model: async ({ threadId, requestId, prompt, signal }) => {
      const hostId = await primaryHostId(bb).catch(() => null);
      if (!hostId) return { ok: false, unavailable: true, error: "BB has no primary host to run the model on." };
      // In Decisions' "thread" mode the model follows the conversation's provider.
      const providerId = (await threadOf(threadId))?.providerId ?? null;
      return deps.decisions.model({ caller: STRANDS_CALLER, requestId, hostId, prompt, providerId }, signal);
    },
    workers: deps.workers,
    interactions: async (threadId) => {
      const list = await bb.sdk.threads.interactions.list({ threadId }) as unknown as (Interaction & { createdAt?: number })[];
      return list.filter((each) => each.status === undefined || each.status === "pending");
    },
    busy: async (threadId) => BUSY.has((await threadOf(threadId))?.status ?? ""),
    ...(deps.extraAsks ? { extraAsks: deps.extraAsks } : {}),
    ...(deps.conversationOfWorker ? { conversationOfWorker: deps.conversationOfWorker } : {}),
    changed,
    log: deps.log,
  });
  const run = (what: string, job: () => Promise<unknown> | void) => { try { void Promise.resolve(job()).catch((error) => deps.log(`Strands ${what}: ${error instanceof Error ? error.message : String(error)}`)); } catch (error) { deps.log(`Strands ${what}: ${String(error)}`); } };
  // BB says the thread is idle or failed: no turn of it is still running.
  bb.events.on("thread.idle", ({ thread }) => run("sort", () => service.idle(thread.id, true)));
  bb.events.on("thread.failed", ({ thread }) => run("sort", () => service.idle(thread.id, true)));
  bb.events.on("thread.active", ({ thread }) => run("early sort", () => service.active(thread.id)));
  bb.events.on("interaction.pending", ({ thread }) => run("early sort", () => service.asked(thread.id)));
  bb.events.on("thread.deleted", ({ thread }) => run("forget", () => service.forget(thread.id)));
  bb.onDispose(() => { disposed = true; if (signal) clearTimeout(signal); service.dispose(); });

  bb.rpc.register(rpcContract, {
    "strands.list": ({ threadId }) => service.list(threadId),
    "strands.items": ({ threadId, limit }) => ({ items: service.items(threadId, limit ?? 200) }),
    "strands.tags": ({ threadId }) => service.tags(threadId),
    "strands.opened": ({ strandId }) => ({ ok: service.opened(strandId) }),
    // Done is the user's own, from Studio's app window: not an agent's, the CLI's or another plugin's.
    "strands.resolveReply": ({ threadId, seq }, context?: unknown) => {
      if (!isAppWindow(context)) throw new experimental_PluginRpcRefusal({ code: "forbidden", message: "Mark it done in the BB Studio app on this Mac." });
      return { ok: service.resolveReply(threadId, seq) };
    },
    "strands.replyPush": ({ threadId, waitMs, requestSeq }) => service.replyPush(threadId, waitMs ?? 20_000, requestSeq ?? null),
    "strands.overview": ({ botId }) => service.overview(botId),
    "strands.move": ({ threadId, seq, strandId }) => ({ ok: service.move(threadId, seq, strandId) }),
    "strands.split": ({ threadId, seq }) => { const strandId = service.split(threadId, seq); return { ok: !!strandId, strandId }; },
    "strands.rename": ({ strandId, title }) => ({ ok: service.rename(strandId, title) }),
    "strands.pin": ({ strandId, pinned }) => ({ ok: service.pin(strandId, pinned) }),
    "strands.merge": ({ strandId, into }) => ({ ok: service.merge(strandId, into) }),
    "strands.unmerge": ({ strandId }) => ({ ok: service.unmerge(strandId) }),
    "strands.unmove": ({ threadId, seq }) => ({ ok: service.unmove(threadId, seq) }),
  });

  // strand_note: the one tool agents use on strands (in place of the task tools).
  bb.agents.registerTool({
    name: STRAND_NOTE_TOOL,
    description: STRAND_NOTE_DESCRIPTION,
    parameters: strandNoteInput,
    execute: async (input: StrandNoteInput, ctx: { threadId?: string | null }) => {
      try { return service.note(ctx?.threadId ?? null, input).line; } catch (error) { return `Error: ${error instanceof Error ? error.message : String(error)}`; }
    },
  } as never);

  const cli = (argv: readonly string[], ctx: { threadId?: string | null }) => runStrandsCli(argv, {
    resolve: async (ref) => strandsThreadFor(ref, ctx.threadId ?? null, { ...deps.scope, enabled: (threadId) => service.enabled(threadId) }),
    list: (threadId) => service.list(threadId),
    items: (threadId, limit) => service.items(threadId, limit),
    sort: (threadId) => service.idle(threadId),
  });
  return { service, cli };
}
