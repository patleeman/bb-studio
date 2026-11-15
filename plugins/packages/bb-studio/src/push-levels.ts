// BB's push level per thread (the push-notifications plugin: all,
// input-only, muted, or inherit for the default). A Bot's workers (leads,
// runners, agents' threads) are set to input-only when they start, on the
// thread itself, so the global and child defaults can stay "all" and only
// questions and errors from them reach the phone. A level the user set stays.
import { z } from "zod";

export const PUSH_PLUGIN_ID = "push-notifications";
const LIST_MAX = 50;

export type PushLevel = "inherit" | "all" | "input-only" | "muted";
type CallRpc = (call: { pluginId: string; method: string; input: never; outputSchema: z.ZodTypeAny; signal?: AbortSignal }) => Promise<unknown>;

const levelSchema = z.enum(["inherit", "all", "input-only", "muted"]);
const listed = z.object({ threads: z.record(z.string(), z.object({ own: levelSchema, ancestorCap: z.object({ level: levelSchema }).passthrough().nullable().optional() }).passthrough()) }).passthrough();

/** The levels BB has for these threads: their own, and a quieter one a parent imposes. Null when push-notifications can't be reached. */
export async function pushLevels(callRpc: CallRpc, threadIds: readonly string[]): Promise<Map<string, { own: PushLevel; cap: PushLevel | null }> | null> {
  const levels = new Map<string, { own: PushLevel; cap: PushLevel | null }>();
  try {
    for (let start = 0; start < threadIds.length; start += LIST_MAX) {
      const batch = threadIds.slice(start, start + LIST_MAX);
      const result = listed.parse(await callRpc({ pluginId: PUSH_PLUGIN_ID, method: "threadNotifications.list", input: { threadIds: batch } as never, outputSchema: z.unknown(), signal: AbortSignal.timeout(10_000) }));
      for (const id of batch) {
        const row = result.threads[id];
        levels.set(id, { own: row?.own ?? "inherit", cap: row?.ancestorCap?.level ?? null });
      }
    }
    return levels;
  } catch { return null; }
}

/** Sets input-only on the threads still at the default. Returns the ones it set; null when push-notifications can't be reached. */
export async function quietByDefault(callRpc: CallRpc, threadIds: readonly string[]): Promise<string[] | null> {
  if (threadIds.length === 0) return [];
  const levels = await pushLevels(callRpc, threadIds);
  if (!levels) return null;
  const set: string[] = [];
  for (const threadId of threadIds) {
    if (levels.get(threadId)?.own !== "inherit") continue;
    try {
      await callRpc({ pluginId: PUSH_PLUGIN_ID, method: "threadNotifications.set", input: { threadId, level: "input-only" } as never, outputSchema: z.unknown(), signal: AbortSignal.timeout(10_000) });
      set.push(threadId);
    } catch { /* the next start retries the sweep */ }
  }
  return set;
}

/** Whether a thread's own level (or a parent's cap) lets a finished turn reach the phone. True when BB can't say. */
export async function repliesAllowed(callRpc: CallRpc, threadId: string): Promise<boolean> {
  const level = (await pushLevels(callRpc, [threadId]))?.get(threadId);
  if (!level) return true;
  return ![level.own, level.cap].some((each) => each === "input-only" || each === "muted");
}
