import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { commandContract, type CommandDelivery, type CommandEntry, type CommandSend, type CommandThread } from "./command-contract";
import type { Store } from "./store";
import { permissionModeFor } from "./external-agents";
import type { ThreadProfiles } from "./thread-profiles";
import { missingThread } from "./mission-runtime";

type Timeline = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["timeline"]>>;
type Row = Timeline["rows"][number];
type Listed = Pick<Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["get"]>>, "id" | "title" | "titleFallback" | "parentThreadId" | "status" | "updatedAt" | "archivedAt">;

/** The most threads a Command view shows; the default Space can hold every thread. */
export const COMMAND_LIMIT = 32;
export const COMMAND_TOPIC = "command-changed";
/** How long after the Command composer was focused its Space answers a bare @. */
export const COMMAND_FOCUS_MS = 10 * 60_000;

const spacesSchema = z.object({ spaces: z.array(z.object({ id: z.string(), name: z.string(), isDefault: z.boolean().catch(false) }).passthrough()) });
const spaceOfSchema = z.object({ threads: z.record(z.string(), z.string()) });
const leadSchema = z.object({ leadThreadId: z.string().nullable() }).passthrough();

const baseName = (path: string) => path.split(/[\\/]/).at(-1) || "Attachment";
const withNames = (text: string, names: string[]) => [text, ...names.map(name => `📎 ${name}`)].filter(Boolean).join("\n\n");

/** Only owner input and the last completed assistant message in each turn. */
export function finalEntries(rows: Row[], completed: ReadonlySet<string> = new Set(), quiet: ReadonlySet<string> = new Set()): CommandEntry[] {
  const entries: CommandEntry[] = [], replies = new Map<string, Row & { kind: "conversation"; role: "assistant" }>();
  const completedTurns = new Set(completed), automationTurns = new Set<string>();
  let unassignedAutomation = false;
  const collect = (items: Row[]) => { for (const row of items) {
    if (row.kind === "conversation" && row.role === "user") {
      const scheduled = /^\[bb automation due:[^\]]+\]\n/.test(row.text);
      if (scheduled && row.turnId) automationTurns.add(row.turnId);
      // BB's initial input is stored before a turn ID has been assigned.
      unassignedAutomation = scheduled && !row.turnId;
    } else if (unassignedAutomation && row.turnId) {
      automationTurns.add(row.turnId);
      unassignedAutomation = false;
    }
    if (row.kind === "turn") { if (row.status === "completed") completedTurns.add(row.turnId ?? row.id); collect(row.children ?? []); }
  } };
  collect(rows);
  const walk = (items: Row[], completed = false) => {
    for (const row of items) {
      if (row.kind === "turn") { walk(row.children ?? [], row.status === "completed"); continue; }
      if (row.kind !== "conversation") continue;
      if (row.role === "user") {
        if (row.initiator !== "user" || row.senderThreadId || row.turnRequest.status === "rejected" || /^\[bb automation due:[^\]]+\]\n/.test(row.text)) continue;
        if (row.text.trim()) entries.push({
          id: `${row.threadId}:${row.id}`, threadId: row.threadId, role: "user", createdAt: row.createdAt,
          text: withNames(row.text, [...(row.attachments?.localFilePaths ?? []), ...(row.attachments?.localImagePaths ?? [])].map(baseName).concat(Array(row.attachments?.webImages ?? 0).fill("Image"))),
        });
      } else if (!quiet.has(row.turnId ?? "") && !automationTurns.has(row.turnId ?? "") && (completed || (row.turnId !== null && completedTurns.has(row.turnId)))) {
        const key = row.turnId ?? row.id;
        const previous = replies.get(key);
        if (!previous || previous.sourceSeqEnd < row.sourceSeqEnd) replies.set(key, row);
      }
    }
  };
  walk(rows);
  for (const row of replies.values()) if (row.text.trim()) entries.push({ id: `${row.threadId}:${row.id}`, threadId: row.threadId, role: "assistant", text: row.text, createdAt: row.createdAt });
  return entries;
}

/**
 * One owner message sent to several threads shows once: the same text within
 * a minute of itself is the same send.
 */
export function mergeEntries(entries: CommandEntry[], limit = 100): CommandEntry[] {
  const sorted = [...entries].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const shown: CommandEntry[] = [];
  for (const entry of sorted) {
    if (entry.role === "user" && shown.some(other => other.role === "user" && other.text === entry.text && other.threadId !== entry.threadId && Math.abs(other.createdAt - entry.createdAt) < 60_000)) continue;
    shown.push(entry);
  }
  return shown.slice(-limit);
}

/**
 * A Space's Command view: its threads, lead first, read from Studio. Nothing
 * is stored here; Studio owns which threads a Space holds.
 */
export class Command {
  constructor(readonly bb: BbPluginApi, readonly store: Store, readonly profiles: ThreadProfiles) {}
  /** Mention providers aren't told which view asked, so the Command composer says which Space it is in. */
  private focused: { spaceId: string; at: number } | null = null;
  private shown = new Map<string, Awaited<ReturnType<Command["space"]>>>();
  changed() { this.bb.realtime.publish(COMMAND_TOPIC, {}); }
  focus(spaceId: string, now = Date.now()) { this.focused = { spaceId, at: now }; }
  /** The focused Space's threads for the "This Space" mention provider; none once the focus is stale. */
  async mentionable(now = Date.now()) {
    const focused = this.focused;
    if (!focused || now - focused.at > COMMAND_FOCUS_MS) return null;
    return this.shown.get(focused.spaceId) ?? await this.space(focused.spaceId);
  }
  private studio<T>(method: string, input: unknown, outputSchema: z.ZodType<T>) {
    return this.bb.sdk.plugins.callRpc({ pluginId: "studio", method, input: input as never, outputSchema, signal: AbortSignal.timeout(10_000) });
  }
  private row(thread: Listed, pending: boolean): CommandThread {
    return { id: thread.id, title: thread.title || thread.titleFallback || "New thread", botId: this.store.byThread(thread.id)?.botId ?? null, parentThreadId: thread.parentThreadId ?? null, status: thread.status, updatedAt: thread.updatedAt, error: null, hasPendingInteraction: pending };
  }
  async space(spaceId: string) {
    const [{ spaces }, { threads: spaceOf }, { leadThreadId }] = await Promise.all([
      this.studio("spaces", null, spacesSchema),
      this.studio("space_of_threads", {}, spaceOfSchema),
      this.studio("space_lead", { spaceId }, leadSchema),
    ]);
    const space = spaces.find(each => each.id === spaceId);
    if (!space) throw new Error("This Space no longer exists.");
    const known = new Set(spaces.map(each => each.id));
    // Threads in no Space, or in one since deleted, belong to the default Space.
    const inSpace = (threadId: string) => spaceOf[threadId] && known.has(spaceOf[threadId]!) ? spaceOf[threadId] === spaceId : space.isDefault;
    const found = new Map<string, Listed>();
    if (space.isDefault) {
      for (let offset = 0;; offset += 100) {
        const page = await this.bb.sdk.threads.list({ archived: false, limit: 100, offset });
        for (const thread of page) if (inSpace(thread.id)) found.set(thread.id, thread);
        if (page.length < 100) break;
      }
    } else {
      const ids = Object.keys(spaceOf).filter(inSpace);
      await Promise.all(ids.map(async threadId => {
        try {
          const thread = await this.bb.sdk.threads.get({ threadId });
          if (thread.archivedAt === null || threadId === leadThreadId) found.set(threadId, thread);
        } catch (cause) { if (!missingThread(cause)) throw cause; }
      }));
    }
    if (leadThreadId && !found.has(leadThreadId)) {
      try { found.set(leadThreadId, await this.bb.sdk.threads.get({ threadId: leadThreadId })); }
      catch (cause) { if (!missingThread(cause)) throw cause; }
    }
    const ordered = [...found.values()].sort((a, b) => Number(b.id === leadThreadId) - Number(a.id === leadThreadId) || b.updatedAt - a.updatedAt).slice(0, COMMAND_LIMIT);
    const threads = await Promise.all(ordered.map(async thread => {
      const pending = await this.bb.sdk.threads.interactions.list({ threadId: thread.id }).then(rows => rows.length > 0, () => false);
      return this.row(thread, pending);
    }));
    // A fork shows under its parent only while the parent is shown too.
    const shown = new Set(threads.map(thread => thread.id));
    for (const thread of threads) if (thread.parentThreadId && !shown.has(thread.parentThreadId)) thread.parentThreadId = null;
    const result = { space: { id: space.id, name: space.name }, leadThreadId: leadThreadId && shown.has(leadThreadId) ? leadThreadId : null, threads };
    this.shown.set(spaceId, result);
    return result;
  }
  /** The latest owner messages and final replies of one thread, without storing them. */
  async entries(threadId: string) {
    const page = await this.bb.sdk.threads.timeline({ threadId, segmentLimit: "60", includeNestedRows: "true" });
    // Text-only turns have no summary wrapper. Read their completion events
    // rather than treating an idle thread or a flat message as proof of finality.
    const sourceRows: Row[] = [];
    const collect = (rows: Row[]) => { for (const row of rows) { sourceRows.push(row); if (row.kind === "turn") collect(row.children ?? []); } };
    collect(page.rows);
    const sourceTurns = new Set(sourceRows.filter(row => row.kind === "conversation" && row.role === "assistant" && row.turnId).map(row => row.turnId!));
    const completed = new Set<string>(), finals = new Map<string, string | null>();
    if (sourceTurns.size) {
      let afterSeq = Math.max(0, Math.min(...sourceRows.map(row => row.sourceSeqStart)) - 1);
      for (;;) {
        const events = await this.bb.sdk.threads.events.list({ threadId, types: ["turn/completed", "item/completed"], afterSeq: String(afterSeq), order: "asc", limit: "100" });
        for (const event of events) {
          if (event.scope.kind !== "turn" || !sourceTurns.has(event.scope.turnId)) continue;
          if (event.type === "item/completed" && event.data.item.type === "agentMessage" && !event.data.item.parentToolCallId) {
            const item = event.data.item;
            if (!("phase" in item) || item.phase !== "commentary") finals.set(event.scope.turnId, item.text);
            else if (!finals.has(event.scope.turnId)) finals.set(event.scope.turnId, null);
          }
          if (event.type === "turn/completed" && event.data.status === "completed") {
            completed.add(event.scope.turnId);
            sourceTurns.delete(event.scope.turnId);
          }
        }
        if (events.length < 100 || !sourceTurns.size) break;
        const next = events.at(-1)!.seq;
        if (next <= afterSeq) throw new Error("BB returned a repeated completion cursor.");
        afterSeq = next;
      }
    }
    const quiet = new Set([...finals].filter(([, text]) => !text?.trim()).map(([turnId]) => turnId));
    return finalEntries(page.rows, completed, quiet);
  }
  async feed(spaceId: string) {
    const { threads } = await this.space(spaceId);
    const all = await Promise.all(threads.map(thread => this.entries(thread.id).catch(() => [] as CommandEntry[])));
    return { entries: mergeEntries(all.flat()) };
  }
  async send(input: CommandSend) {
    const { space, threads } = await this.space(input.spaceId);
    for (const id of input.threadIds) if (!threads.some(thread => thread.id === id)) throw new Error("A recipient must be one of this Space's threads.");
    const targets = [...new Set(input.threadIds)];
    const roster = targets.map(threadId => ({ threadId, bot: this.botName(threadId) }));
    const prompt = [
      `[Studio Command message to ${targets.length === 1 ? "one thread" : `${targets.length} threads`} in Space ${JSON.stringify(space.name)}]`,
      `Recipients: ${JSON.stringify(roster)}`,
      targets.length > 1 ? "The owner addressed these threads together. You may read and message the listed threads to coordinate this request using bb thread log/tell. Work in this normal thread. If another recipient has covered your result, finish without a final assistant message." : "Work in this normal thread.",
    ].join("\n");
    const deliveries: CommandDelivery[] = [];
    for (const target of targets) {
      let threadId = target;
      try {
        if (input.mode === "fork") {
          const fork = await this.bb.sdk.threads.fork({ sourceThreadId: target, visibility: "visible" });
          const botId = this.store.byThread(target)?.botId;
          if (botId) this.profiles.attach(this.store.get(botId), fork.id);
          threadId = fork.id;
        }
        const botId = this.store.byThread(threadId)?.botId;
        // Outside agents accept fewer modes; a mode for everyone can't push one they refuse.
        const mode = input.permissionMode && botId ? permissionModeFor(this.store.get(botId).providerId, input.permissionMode) : input.permissionMode;
        const sent = await this.bb.sdk.threads.send({
          threadId,
          input: [{ type: "text", text: input.text, mentions: [] }, { type: "text", text: prompt, mentions: [], visibility: "agent-only" }, ...input.attachments],
          mode: input.mode === "followup" ? "queue-if-active" : input.mode === "steer" ? "steer-if-active" : "auto",
          ...(mode ? { permissionMode: mode, executionInputSources: { permissionMode: "explicit" as const } } : {}),
        });
        deliveries.push({ threadId, status: sent.delivery, error: null });
      } catch (cause) { deliveries.push({ threadId, status: "error", error: String(cause) }); }
    }
    this.changed();
    return { deliveries };
  }
  private botName(threadId: string) {
    const botId = this.store.byThread(threadId)?.botId;
    return botId ? this.store.get(botId).name : null;
  }
  handlers(): PluginRpcHandlers<typeof commandContract> {
    return {
      command: ({ spaceId }) => this.space(spaceId),
      commandFeed: ({ spaceId }) => this.feed(spaceId),
      commandSend: input => this.send(input),
      commandFocus: ({ spaceId }) => { this.focus(spaceId); return { ok: true as const }; },
    };
  }
}
