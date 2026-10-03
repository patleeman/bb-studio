import type { ViewThread } from "./view-contract";

export const CHANNEL_LAYOUTS = [
  { id: "merged", label: "Merged", detail: "Final replies in one conversation." },
  { id: "grid", label: "Grid", detail: "Every member’s complete thread." },
  { id: "active", label: "Active", detail: "Working threads take the main area." },
  { id: "focus", label: "Focus", detail: "One selected thread at a time." },
] as const;
export type ChannelLayout = typeof CHANNEL_LAYOUTS[number]["id"];
export function channelLayout(value: unknown): ChannelLayout {
  return CHANNEL_LAYOUTS.some(layout => layout.id === value) ? value as ChannelLayout : "merged";
}
export function threadActivity(thread: ViewThread) {
  if (thread.error) return "Unavailable";
  if (thread.hasPendingInteraction) return "Needs input";
  if (thread.status === "error") return "Failed";
  if (["active", "starting"].includes(thread.status)) return "Working";
  return "Idle";
}
export function activeThreads(threads: ViewThread[]) {
  return threads.filter(thread => ["Working", "Needs input"].includes(threadActivity(thread)));
}
export function focusedThread(threads: ViewThread[], selected: string | null) {
  return threads.find(thread => thread.id === selected) ?? activeThreads(threads)[0] ?? threads.find(thread => !thread.parentThreadId) ?? threads[0];
}
const ATTENTION = ["Needs input", "Failed", "Working", "Idle", "Unavailable"];
/** Threads that need the owner first, then working ones, then the most recently updated. */
export function byAttention(threads: ViewThread[]) {
  return [...threads].sort((a, b) => ATTENTION.indexOf(threadActivity(a)) - ATTENTION.indexOf(threadActivity(b)) || b.updatedAt - a.updatedAt);
}
/** Grid order: panes the owner arranged keep their places; the rest follow in attention order. */
export function arrangeGrid(threads: ViewThread[], order: string[]) {
  const placed = order.flatMap(id => threads.filter(thread => thread.id === id));
  return [...placed, ...byAttention(threads.filter(thread => !order.includes(thread.id)))];
}
/** Moves `id` to just before or after `target` in the visible ids. */
export function movePane(ids: string[], id: string, target: string, place: "before" | "after") {
  if (id === target || !ids.includes(id) || !ids.includes(target)) return ids;
  const rest = ids.filter(other => other !== id);
  const at = rest.indexOf(target) + (place === "after" ? 1 : 0);
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}
