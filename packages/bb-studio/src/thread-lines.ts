// Each thread's latest line for the sidebar's two-line rows: its last
// assistant prose, or the failure or blocker that stopped it.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

// Event rows use createdAt and a scoped turn id; payloads live in data.
// Only durable messages and lifecycle evidence are read, never streaming deltas,
// user inputs, reasoning, tool arguments, commands or tool output.
const EVENT_TYPES = ["item/completed", "turn/started", "turn/completed", "provider/error", "system/error", "system/interaction/lifecycle", "system/userQuestion/lifecycle"] as const;
export const STATUS_THREAD_LIMIT = 40;
export const STATUS_EVENT_LIMIT = 100;
const ACTIVITY_LIMIT = 20;
const rowSchema = z.object({
  id: z.string(), type: z.string(), createdAt: z.number().finite().nonnegative(),
  seq: z.number().finite().optional(), threadId: z.string().optional(),
  scope: z.object({ kind: z.string(), turnId: z.string().optional() }).optional(),
  data: z.record(z.string(), z.unknown()),
});
const messageSchema = z.object({ type: z.literal("agentMessage"), text: z.string(), parentToolCallId: z.string().optional() });
const errorSchema = z.object({ message: z.string() });
const interactionSchema = z.object({ id: z.string(), payload: z.object({ kind: z.string() }), status: z.enum(["pending", "resolving", "resolved", "interrupted"]) });
const questionSchema = z.object({ interactionId: z.string(), status: z.enum(["pending", "resolving", "resolved", "interrupted"]) });

type Thread = { id: string; title: string; status: string; updatedAt: number; isLead: boolean };
export type ThreadProgress = { progress: string | null; progressAt: number | null; failureReason: string | null; blockedReason: string | null };
export type ThreadActivity = { id: string; threadId: string; title: string; isLead: boolean; kind: "progress" | "failure" | "blocked"; summary: string; at: number };

/**
 * A line that is only a directive, such as the Next row's `::next{reply="…"}`
 * or `::reactions{…}`. BB renders these as buttons, so they aren't prose.
 */
const DIRECTIVE_LINE = /^[ \t]*::[A-Za-z][\w-]*(?:\[[^\]\n]*\])?(?:\{[^\n]*\})?[ \t]*$/gmu;

/** Keep prose bounded and omit code excerpts, including commands quoted in messages, and directives. */
function prose(value: string): string | null {
  const text = value.slice(0, 12_000).replace(DIRECTIVE_LINE, " ").replace(/```[\s\S]*?(?:```|$)/gu, " ").replace(/`[^`]*`/gu, " ").replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
  return text ? text.slice(0, 240) : null;
}

export function parseThreadStatus(thread: Thread, input: unknown): { progress: ThreadProgress; activity: ThreadActivity[] } {
  const rows = (Array.isArray(input) ? input.slice(0, STATUS_EVENT_LIMIT) : []).flatMap((value) => {
    const parsed = rowSchema.safeParse(value);
    return parsed.success && (!parsed.data.threadId || parsed.data.threadId === thread.id) ? [parsed.data] : [];
  }).sort((a, b) => b.createdAt - a.createdAt || (b.seq ?? 0) - (a.seq ?? 0));
  const progress: ThreadProgress = { progress: null, progressAt: null, failureReason: null, blockedReason: null };
  const activity: ThreadActivity[] = [];
  const turns = new Set<string>();
  const interactions = new Set<string>();
  let latestTurnSeen = false;
  let recoveryAt = -1;
  const add = (row: typeof rows[number], kind: ThreadActivity["kind"], text: string) => {
    if (activity.length < 3) activity.push({ id: row.id, threadId: thread.id, title: thread.title, isLead: thread.isLead, kind, summary: text, at: row.createdAt });
  };
  for (const row of rows) {
    const data = row.data;
    if (row.type === "item/completed") {
      const message = messageSchema.safeParse(data.item);
      if (!message.success || message.data.parentToolCallId || data.parentToolCallId) continue;
      const text = prose(message.data.text);
      if (!text) continue;
      if (progress.progress === null) { progress.progress = text; progress.progressAt = row.createdAt; }
      // One update per turn; older payloads without scope produce one update.
      const turn = row.scope?.turnId ?? "unscoped";
      if (!turns.has(turn)) { turns.add(turn); add(row, "progress", text); }
    } else if (row.type === "turn/started" || row.type === "turn/completed") {
      if (latestTurnSeen) continue;
      if (row.type === "turn/completed" && (typeof data.status !== "string" || !["completed", "failed", "interrupted"].includes(data.status))) continue;
      latestTurnSeen = true;
      if (row.type === "turn/started" || data.status !== "failed") { recoveryAt = row.createdAt; continue; }
      const error = errorSchema.safeParse(data.error);
      const reason = error.success ? prose(error.data.message) : null;
      progress.failureReason ??= reason ?? "The latest turn failed.";
      if (!activity.some((event) => event.kind === "failure")) add(row, "failure", progress.failureReason);
    } else if (row.type === "provider/error" || row.type === "system/error") {
      const error = errorSchema.safeParse(data);
      if (!error.success) continue;
      const reason = prose(error.data.message) ?? "The thread reported an error.";
      // A retrying provider is not evidence that the thread has failed.
      if (data.willRetry === true || row.createdAt <= recoveryAt) continue;
      progress.failureReason ??= reason;
      if (!activity.some((event) => event.kind === "failure")) add(row, "failure", reason);
    } else if (row.type === "system/interaction/lifecycle" || row.type === "system/userQuestion/lifecycle") {
      const interaction = row.type === "system/interaction/lifecycle" ? interactionSchema.safeParse(data.interaction) : questionSchema.safeParse(data);
      if (!interaction.success) continue;
      const value = interaction.data;
      const id = "id" in value ? value.id : value.interactionId;
      if (interactions.has(id)) continue;
      interactions.add(id);
      if (value.status !== "pending" && value.status !== "resolving") continue;
      const reason = "payload" in value && value.payload.kind === "approval" ? "Waiting for approval." : "Waiting for a user response.";
      progress.blockedReason ??= reason;
      if (!activity.some((event) => event.kind === "blocked")) add(row, "blocked", reason);
    }
  }
  return { progress, activity: activity.sort((a, b) => b.at - a.at) };
}

/** A single bounded scan per selected thread; missing/failed event APIs return empty evidence. */
export async function spaceThreadStatus<T extends Thread>(sdk: Pick<BbPluginApi["sdk"], "threads">, threads: T[]) {
  const selected = [...threads].sort((a, b) => Number(b.isLead) - Number(a.isLead) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)).slice(0, STATUS_THREAD_LIMIT);
  const results = new Map<string, ReturnType<typeof parseThreadStatus>>();
  let next = 0;
  const signal = AbortSignal.timeout(3000);
  await Promise.all(Array.from({ length: Math.min(4, selected.length) }, async () => {
    while (next < selected.length && !signal.aborted) {
      const thread = selected[next++]!;
      let events: unknown = [];
      try {
        if (typeof sdk.threads.events?.list === "function") events = await sdk.threads.events.list({ threadId: thread.id, order: "desc", limit: String(STATUS_EVENT_LIMIT), types: EVENT_TYPES, signal });
      } catch { /* A transport failure is not a thread failure. */ }
      results.set(thread.id, parseThreadStatus(thread, events));
    }
  }));
  return {
    threads: threads.map((thread) => ({ ...thread, ...(results.get(thread.id)?.progress ?? parseThreadStatus(thread, []).progress) })),
    activity: [...results.values()].flatMap((result) => result.activity).sort((a, b) => b.at - a.at || a.threadId.localeCompare(b.threadId) || a.id.localeCompare(b.id)).slice(0, ACTIVITY_LIMIT),
  };
}

type Line = { text: string; kind: "progress" | "failure" | "blocked"; at: number | null };

/** The latest line per thread, read from its events and kept briefly so sidebars can poll. */
export function createThreadLines(sdk: Pick<BbPluginApi["sdk"], "threads">, ttlMs = 15_000) {
  const cache = new Map<string, { line: Line | null; until: number }>();
  return {
    async read(threadIds: readonly string[]): Promise<Record<string, Line>> {
      const now = Date.now();
      const stale = threadIds.filter((id) => (cache.get(id)?.until ?? 0) <= now);
      if (stale.length) {
        const { threads } = await spaceThreadStatus(sdk, stale.map((id) => ({ id, title: "", status: "idle", updatedAt: 0, isLead: false })));
        for (const thread of threads) {
          const line: Line | null = thread.blockedReason ? { text: thread.blockedReason, kind: "blocked", at: null }
            : thread.failureReason ? { text: thread.failureReason, kind: "failure", at: null }
              : thread.progress ? { text: thread.progress, kind: "progress", at: thread.progressAt }
                : null;
          cache.set(thread.id, { line, until: now + ttlMs });
        }
      }
      const lines: Record<string, Line> = {};
      for (const id of threadIds) {
        const line = cache.get(id)?.line;
        if (line) lines[id] = line;
      }
      return lines;
    },
  };
}
