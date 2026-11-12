// One mute, not two. BB's push-notifications plugin keeps a notification
// level per thread ("muted" among them) and applies it before it sends
// anything. A thread muted from the phone is muted there: this module sets
// and reads that level. Mobile still keeps its own list of the ids the phone
// muted, as the list the app shows and as the whole mechanism on a BB where
// push-notifications is off or missing.
import { z } from "zod";

export const PUSH_PLUGIN_ID = "push-notifications";
const LIST_MAX = 50;

type CallRpc = (call: { pluginId: string; method: string; input: never; outputSchema: z.ZodTypeAny }) => Promise<unknown>;

const inputs = z.object({ own: z.string() }).passthrough();
const listed = z.object({ threads: z.record(z.string(), inputs) }).passthrough();

/** Sets BB's level for a thread: muted, or back to its default. False when push-notifications can't be reached. */
export async function setThreadMuted(callRpc: CallRpc, threadId: string, muted: boolean): Promise<boolean> {
  try {
    await callRpc({ pluginId: PUSH_PLUGIN_ID, method: "threadNotifications.set", input: { threadId, level: muted ? "muted" : "inherit" } as never, outputSchema: z.unknown() });
    return true;
  } catch { return false; }
}

/**
 * Of `threadIds`, the ones BB still has muted. A thread unmuted on the
 * desktop drops out. Null when push-notifications can't be reached, so the
 * caller keeps its own list.
 */
export async function stillMuted(callRpc: CallRpc, threadIds: readonly string[]): Promise<string[] | null> {
  if (threadIds.length === 0) return [];
  const kept: string[] = [];
  try {
    for (let start = 0; start < threadIds.length; start += LIST_MAX) {
      const batch = threadIds.slice(start, start + LIST_MAX);
      const result = listed.parse(await callRpc({ pluginId: PUSH_PLUGIN_ID, method: "threadNotifications.list", input: { threadIds: batch } as never, outputSchema: z.unknown() }));
      for (const id of batch) if (result.threads[id]?.own === "muted") kept.push(id);
    }
    return kept;
  } catch { return null; }
}
