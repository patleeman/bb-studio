// The move-provider service on the real SDK: BB threads, core's move hook,
// W2's handoff, BB's automations plugin, Studio's tables,
// Bots and the router. The watcher listens to thread.idle.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";
import { automationsPluginOff } from "../automations-plugin";
import { mapPool } from "../kit/pool";
import { noteProviders } from "../provider-family";
import { isPermissionMode, type PermissionMode, type RouterPolicy } from "./core";
import { MoveProviderService, type BbAutomation, type BotRef, type MoveDeps, type MoveEventStatus, type TargetCheck, type ThreadInfo } from "./service";

type Listed = { id: string; title?: string | null; titleFallback?: string | null; providerId?: string | null; status?: string; archivedAt?: number | null; projectId?: string | null };

const PAGE = 200;

/** W1's hook: refusals come back as { ok: false }, never thrown. */
type MoveThreadProviderResult =
  | { ok: true; status: "moved" | "already-moved" | "would-move"; threadId: string }
  | { ok: false; threadId: string; httpStatus?: number; code?: string; message?: string; reason?: string };
interface MoveHooks {
  experimental_features?: { providerMove?: unknown };
  experimental_moveThreadProvider?(threadId: string, input: { providerId: string; model?: string; permissionMode?: "accept-edits" | "auto" | "full"; historyTokens?: number; dryRun?: boolean; includeArchived?: boolean }): Promise<MoveThreadProviderResult>;
}
const PROBE_WAIT_MS = 10 * 60_000;
/** How far back status and verify look for the move: 20 pages of 100 operations and turn starts. */
const EVENT_PAGES = 20;

export interface MoveRegisterDeps {
  bb: BbPluginApi;
  db: Database.Database;
  bots(): BotRef[];
  botThreads(botId: string): Promise<string[]>;
  setBotDefault(botId: string, providerId: string, model: string): Promise<void>;
  leadThreads(): string[];
  internal?: MoveDeps["internal"];
  router?: { get(): Promise<RouterPolicy>; set(policy: RouterPolicy): Promise<void> };
  /** W2's handoff builder; through Studio's own RPC by default. */
  prepare?: MoveDeps["prepare"];
  handoffDelivered?: MoveDeps["handoffDelivered"];
}

/** Core's isRealTurnInput: anything but a bare /compact or /clear. */
export function realTurnInput(input: unknown): boolean {
  if (!Array.isArray(input)) return true;
  const texts = input.filter((item) => (item as { type?: string }).type === "text").map((item) => String((item as { text?: unknown }).text ?? "").trim());
  return !(input.length === 1 && texts.length === 1 && (texts[0] === "/compact" || texts[0] === "/clear"));
}

const automationSchema = z.object({ id: z.string(), name: z.string(), execution: z.record(z.string(), z.unknown()) }).passthrough();

export function createMoveProvider(deps: MoveRegisterDeps): MoveProviderService {
  const { bb, db } = deps;
  const sdk = bb.sdk;

  const withOptions = async (threads: Listed[]): Promise<ThreadInfo[]> => mapPool(threads, 6, async (thread) => {
    const options = await sdk.threads.defaultExecutionOptions({ threadId: thread.id }).catch(() => null) as { model?: string | null; permissionMode?: string | null } | null;
    return {
      id: thread.id, title: thread.title?.trim() || thread.titleFallback?.trim() || "Untitled thread", providerId: thread.providerId ?? null,
      model: options?.model ?? null, permission: isPermissionMode(options?.permissionMode) ? options!.permissionMode as PermissionMode : null,
      status: thread.status ?? "idle", archived: thread.archivedAt != null, projectId: thread.projectId ?? null,
    };
  });

  const listAll = async (filter: { projectId?: string; archived: boolean }): Promise<Listed[]> => {
    const out: Listed[] = [];
    for (let page = 0; ; page++) {
      const batch = await sdk.threads.list({ archived: filter.archived, includeHidden: true, limit: PAGE, offset: page * PAGE, ...(filter.projectId ? { projectId: filter.projectId } : {}) }) as Listed[];
      out.push(...batch);
      if (batch.length < PAGE) return out;
    }
  };

  const getThreads = async (ids: readonly string[]): Promise<ThreadInfo[]> => {
    const found: Listed[] = [];
    for (let index = 0; index < ids.length; index += PAGE) {
      const batch = ids.slice(index, index + PAGE);
      for (const archived of [false, true]) found.push(...await sdk.threads.list({ threadIds: batch, archived, includeHidden: true, limit: PAGE } as never).catch(() => []) as Listed[]);
    }
    const unique = [...new Map(found.map((thread) => [thread.id, thread])).values()];
    return withOptions(unique);
  };

  const moveEvents = async (threadId: string): Promise<MoveEventStatus> => {
    // The move is a system/operation event with data.operation "thread/provider-move" (W1). Newest first,
    // 100 a page (BB's cap): turns after it say the first turn on the new provider started, and completed.
    type Row = { seq: number | string; type: string; createdAt?: number; data?: { operation?: string; status?: string; requestId?: string; clientRequestId?: string; input?: unknown; metadata?: { to?: { providerId?: string; model?: string | null }; at?: number | string; handoff?: string } } };
    let turnStarted = false;
    let turnCompleted = false;
    // As core counts it: a real request (not a bare /compact or /clear) made after the move, accepted by the provider.
    const accepted = new Set<string>();
    const real = new Set<string>();
    let before: string | undefined;
    for (let page = 0; page < EVENT_PAGES; page++) {
      const rows = await sdk.threads.events.list({ threadId, order: "desc", limit: "100", types: ["system/operation", "turn/started", "turn/completed", "turn/input/accepted", "client/turn/requested", "client/thread/start"], ...(before ? { beforeSeq: before } : {}) } as never) as Row[];
      for (const row of rows) {
        if (row.type === "turn/started") { turnStarted = true; continue; }
        if (row.type === "turn/input/accepted") { if (row.data?.clientRequestId) accepted.add(row.data.clientRequestId); continue; }
        if (row.type === "client/turn/requested" || row.type === "client/thread/start") { if (row.data?.requestId && realTurnInput(row.data.input)) real.add(row.data.requestId); continue; }
        // Only a turn that completed well counts, as core's status says: a failed first turn leaves the move pending.
        if (row.type === "turn/completed") { if (row.data?.status === "completed") turnCompleted = true; continue; }
        if (row.type === "system/operation" && row.data?.operation === "thread/provider-move") {
          const meta = row.data.metadata;
          const at = typeof meta?.at === "string" ? Date.parse(meta.at) || row.createdAt || 0 : meta?.at ?? row.createdAt ?? 0;
          return { move: { seq: Number(row.seq), at, to: { providerId: meta?.to?.providerId ?? "", model: meta?.to?.model ?? null }, handoff: meta?.handoff ?? null }, turnStarted, turnCompleted, inputAccepted: [...real].some((id) => accepted.has(id)) };
        }
      }
      if (rows.length < 100) break;
      before = String(rows.at(-1)!.seq);
    }
    return { move: null, turnStarted: false, turnCompleted: false };
  };

  const automationsOff = automationsPluginOff(sdk);
  const callAutomations = <T>(method: string, input: unknown, schema: z.ZodType<T>) => sdk.plugins.callRpc({ pluginId: "automations", method, input: input as never, outputSchema: schema });

  const service = new MoveProviderService({
    kv: bb.storage.kv,
    listThreads: async ({ providerId, projectId, includeArchived }) => {
      const listed = [...await listAll({ projectId, archived: false }), ...(includeArchived ? await listAll({ projectId, archived: true }) : [])];
      return withOptions(listed.filter((thread) => !providerId || thread.providerId === providerId));
    },
    getThreads,
    bots: deps.bots,
    botThreads: deps.botThreads,
    runnerThreads: (botId) => (db.prepare(`SELECT id, bot_id, name, thread_id FROM bot_runners WHERE thread_id IS NOT NULL AND cleanup_pending = 0${botId ? " AND bot_id = ?" : ""}`).all(...(botId ? [botId] : [])) as { id: string; bot_id: string; name: string; thread_id: string }[])
      .map((row) => ({ id: row.id, botId: row.bot_id, name: row.name, threadId: row.thread_id })),
    leadThreads: async () => deps.leadThreads(),
    ...(deps.internal ? { internal: deps.internal } : {}),
    target: async (providerId): Promise<TargetCheck> => {
      const [catalog, providers] = await Promise.all([
        sdk.providers.catalog().catch(() => []) as Promise<{ id: string; enabled?: boolean }[]>,
        sdk.providers.list().catch(() => []) as Promise<{ id: string; family?: string; capabilities?: { permissionModes?: readonly string[] } }[]>,
      ]);
      noteProviders(providers);
      const entry = catalog.find((each) => each.id === providerId);
      if (!entry || entry.enabled === false) return { known: false, ready: false, models: [], defaultModel: null, permissionModes: null };
      const modes = providers.find((each) => each.id === providerId)?.capabilities?.permissionModes;
      const models = await sdk.providers.models({ providerId }).then((result) => result.models as readonly { model: string; isDefault?: boolean }[], () => null);
      return {
        known: true, ready: !!models, models: models?.map((each) => each.model) ?? [], defaultModel: (models?.find((each) => each.isDefault) ?? models?.[0])?.model ?? null,
        permissionModes: modes?.length ? modes.filter(isPermissionMode) : null,
      };
    },
    // Core's move (W1): bb.experimental_hooks.experimental_moveThreadProvider, never loopback HTTP.
    coreMove: async (threadId, body) => {
      const hooks = (bb as { experimental_hooks?: MoveHooks }).experimental_hooks;
      if (hooks?.experimental_features?.providerMove !== true || typeof hooks.experimental_moveThreadProvider !== "function") {
        return { status: 501, body: { code: "core_unavailable", message: "this BB Studio build can't move providers; update the app" } };
      }
      const result = await hooks.experimental_moveThreadProvider(threadId, body);
      if (result.ok) return { status: 200, body: { status: result.status } };
      return { status: result.httpStatus ?? 0, body: { code: result.code, message: result.message, reason: result.reason } };
    },
    prepare: deps.prepare ?? (async (threadId, input) => await sdk.plugins.callRpc({ pluginId: "studio", method: "moveProvider.prepare", input: { threadId, ...input } as never, outputSchema: z.object({ ok: z.boolean(), transcriptPath: z.string().nullish(), verbatimTurns: z.number().optional(), outlinedTurns: z.number().optional(), bytes: z.number().optional(), error: z.string().optional() }).passthrough() })),
    bbAutomations: async () => {
      // BB's automations plugin off (a BB Studio copy runs Studio's own): nothing of BB's to patch.
      if (await automationsOff()) return [];
      const projects = await sdk.projects.list().catch(() => []) as { id: string }[];
      const out: BbAutomation[] = [];
      for (const project of projects) {
        const listed = await callAutomations("automations_list", { projectId: project.id }, z.array(automationSchema));
        for (const each of listed) out.push({ id: each.id, name: each.name, projectId: project.id, execution: each.execution as BbAutomation["execution"] });
      }
      return out;
    },
    updateBbAutomation: async (automation, execution) => { await callAutomations("automations_update", { projectId: automation.projectId, automationId: automation.id, execution }, z.unknown()); },
    studioAutomations: (threadIds) => threadIds.length
      ? (db.prepare(`SELECT id, name, target_thread_id, provider_id, model FROM bot_automations WHERE cleanup_pending = 0 AND target_thread_id IN (${threadIds.map(() => "?").join(", ")})`).all(...threadIds) as { id: string; name: string; target_thread_id: string; provider_id: string | null; model: string | null }[])
        .map((row) => ({ id: row.id, name: row.name, threadId: row.target_thread_id, providerId: row.provider_id, model: row.model }))
      : [],
    setStudioAutomationModel: (id, providerId, model) => { db.prepare("UPDATE bot_automations SET provider_id = ?, model = ?, updated_at = ? WHERE id = ?").run(providerId, model, Date.now(), id); },
    setBotDefault: deps.setBotDefault,
    ...(deps.router ? { router: deps.router } : {}),
    moveEvents,
    ...(deps.handoffDelivered ? { handoffDelivered: deps.handoffDelivered } : {}),
    ask: async (threadId, question) => {
      type Ev = { seq: number | string; type: string; parentToolCallId?: string | null; data?: { parentToolCallId?: string | null; item?: { type?: string; text?: string; parentToolCallId?: string | null } } };
      /** A root turn's event: not a subagent's (core's isRootTurnStartedEventData). */
      const root = (event: Ev) => !event.parentToolCallId && !event.data?.parentToolCallId && !event.data?.item?.parentToolCallId;
      const newest = await sdk.threads.events.list({ threadId, order: "desc", limit: "1" }).catch(() => []) as { seq: number | string }[];
      const sentAfter = newest[0] ? String(newest[0].seq) : undefined;
      await sdk.threads.send({ threadId, mode: "queue-if-active", input: [{ type: "text", text: `Verification question from the provider move (answer in one or two lines, from this conversation's history; don't use tools): ${question}`, mentions: [], visibility: "agent-only" }] } as never);
      const until = Date.now() + PROBE_WAIT_MS;
      const waitFor = async (type: string, afterSeq: string | undefined): Promise<Ev> => {
        let cursor = afterSeq;
        for (;;) {
          const seen = await sdk.threads.events.wait({ threadId, type, waitMs: "30000", ...(cursor ? { afterSeq: cursor } : {}) }).catch(() => null) as Ev | null;
          if (seen && root(seen)) return seen;
          // A subagent's turn: keep waiting past it for the root one.
          if (seen) cursor = String(seen.seq);
          if (Date.now() > until) throw new Error("no answer within 10 minutes");
        }
      };
      // The probe's own turn: the first that started after it was sent (a running turn started before), then its end.
      const started = await waitFor("turn/started", sentAfter);
      const completed = await waitFor("turn/completed", String(started.seq));
      const events = await sdk.threads.events.list({ threadId, order: "asc", limit: "100", types: ["item/completed"], afterSeq: String(started.seq) } as never) as Ev[];
      const inTurn = events.filter((event) => Number(event.seq) < Number(completed.seq) && root(event));
      return inTurn.map((event) => event.data?.item).filter((item) => item?.type === "agentMessage" && item.text).at(-1)?.text ?? "";
    },
    log: (line) => bb.log.info(line),
  });

  // Deferred threads move once idle. A sweep at start finds those that went idle while Studio was down.
  bb.events.on("thread.deleted", ({ thread }) => void service.forgetThread(thread.id).catch(() => {}));
  bb.events.on("thread.idle", ({ thread }) => void service.onIdle(thread.id).catch((error) => bb.log.warn(`Move provider: ${error instanceof Error ? error.message : String(error)}`)));
  setTimeout(() => void service.sweep().catch(() => {}), 30_000).unref?.();
  return service;
}
