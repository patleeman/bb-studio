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
