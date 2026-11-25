// The move-provider service on the real SDK: BB threads, the core route on
// BB's loopback, W2's handoff RPC, BB's automations plugin, Studio's tables,
// Bots and the router. The watcher listens to thread.idle.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { z } from "zod";
import { automationsPluginOff } from "../automations-plugin";
import { mapPool } from "../kit/pool";
import { isPermissionMode, type PermissionMode, type RouterPolicy } from "./core";
import { MoveProviderService, type BbAutomation, type BotRef, type MoveDeps, type MoveEventStatus, type TargetCheck, type ThreadInfo } from "./service";

type Listed = { id: string; title?: string | null; titleFallback?: string | null; providerId?: string | null; status?: string; archivedAt?: number | null; projectId?: string | null };

const PAGE = 200;
const PROBE_WAIT_MS = 10 * 60_000;

export interface MoveRegisterDeps {
  bb: BbPluginApi;
  db: Database.Database;
  bots(): BotRef[];
  botThreads(botId: string): Promise<string[]>;
  setBotDefault(botId: string, providerId: string, model: string): Promise<void>;
  leadThreads(): string[];
  router?: { get(): Promise<RouterPolicy>; set(policy: RouterPolicy): Promise<void> };
  /** W2's handoff builder; through Studio's own RPC by default. */
  prepare?: MoveDeps["prepare"];
  handoffDelivered?: MoveDeps["handoffDelivered"];
  fetchImpl?: typeof fetch;
}

const automationSchema = z.object({ id: z.string(), name: z.string(), execution: z.record(z.string(), z.unknown()) }).passthrough();

export function createMoveProvider(deps: MoveRegisterDeps): MoveProviderService {
  const { bb, db } = deps;
  const sdk = bb.sdk;
  const fetchImpl = deps.fetchImpl ?? fetch;

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
    // The move is a system/operation event with data.operation "thread/provider-move" (W1).
    const rows = await sdk.threads.events.list({ threadId, order: "desc", limit: "200", types: ["system/operation", "turn/started"] } as never) as { seq: number | string; type: string; createdAt?: number; data?: { operation?: string; metadata?: { to?: { providerId?: string; model?: string | null }; at?: number } } }[];
    let turnStarted = false;
    for (const row of rows) {
      if (row.type === "turn/started") { turnStarted = true; continue; }
      if (row.type === "system/operation" && row.data?.operation === "thread/provider-move") {
        const to = row.data.metadata?.to;
        return { move: { seq: Number(row.seq), at: row.data.metadata?.at ?? row.createdAt ?? 0, to: { providerId: to?.providerId ?? "", model: to?.model ?? null } }, turnStarted };
      }
    }
    return { move: null, turnStarted: false };
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
    target: async (providerId): Promise<TargetCheck> => {
      const [catalog, providers] = await Promise.all([
        sdk.providers.catalog().catch(() => []) as Promise<{ id: string; enabled?: boolean }[]>,
        sdk.providers.list().catch(() => []) as Promise<{ id: string; capabilities?: { permissionModes?: readonly string[] } }[]>,
      ]);
      const entry = catalog.find((each) => each.id === providerId);
      if (!entry || entry.enabled === false) return { known: false, ready: false, models: [], defaultModel: null, permissionModes: null };
      const modes = providers.find((each) => each.id === providerId)?.capabilities?.permissionModes;
      const models = await sdk.providers.models({ providerId }).then((result) => result.models as readonly { model: string; isDefault?: boolean }[], () => null);
      return {
        known: true, ready: !!models, models: models?.map((each) => each.model) ?? [], defaultModel: (models?.find((each) => each.isDefault) ?? models?.[0])?.model ?? null,
        permissionModes: modes?.length ? modes.filter(isPermissionMode) : null,
      };
    },
    coreMove: async (threadId, body) => {
      const base = bb.server.loopbackBaseUrl;
      if (!base) return { status: 0, body: { message: "BB's loopback address is unknown" } };
      const response = await fetchImpl(`${base}/api/v1/threads/${encodeURIComponent(threadId)}/move-provider`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json().catch(() => null) };
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
      const before = await sdk.threads.events.list({ threadId, order: "desc", limit: "1" }).catch(() => []) as { seq: number | string }[];
      const after = before[0] ? String(before[0].seq) : undefined;
      await sdk.threads.send({ threadId, mode: "queue-if-active", input: [{ type: "text", text: `Verification question from the provider move (answer in one or two lines, from this conversation's history; don't use tools): ${question}`, mentions: [], visibility: "agent-only" }] } as never);
      const until = Date.now() + PROBE_WAIT_MS;
      // Queued behind a running turn, the question's own turn comes later: wait until the thread is idle.
      let cursor = after;
      for (;;) {
        const seen = await sdk.threads.events.wait({ threadId, type: "turn/completed", waitMs: "30000", ...(cursor ? { afterSeq: cursor } : {}) }).catch(() => null) as { seq?: number | string } | null;
        if (seen?.seq !== undefined) cursor = String(seen.seq);
        const now = await sdk.threads.get({ threadId }).catch(() => null) as { status?: string } | null;
        if (now && !["starting", "active", "stopping"].includes(now.status ?? "")) break;
        if (Date.now() > until) throw new Error("no answer within 10 minutes");
      }
      const events = await sdk.threads.events.list({ threadId, order: "desc", limit: "40", types: ["item/completed"], ...(after ? { afterSeq: after } : {}) } as never) as { data?: { item?: { type?: string; text?: string } } }[];
      return events.map((event) => event.data?.item).find((item) => item?.type === "agentMessage" && item.text)?.text ?? "";
    },
    log: (line) => bb.log.info(line),
  });

  // Deferred threads move once idle. A sweep at start finds those that went idle while Studio was down.
  bb.events.on("thread.idle", ({ thread }) => void service.onIdle(thread.id).catch((error) => bb.log.warn(`Move provider: ${error instanceof Error ? error.message : String(error)}`)));
  setTimeout(() => void service.sweep().catch(() => {}), 30_000).unref?.();
  return service;
}
