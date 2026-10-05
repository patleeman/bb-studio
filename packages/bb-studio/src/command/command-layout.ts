import type { CommandSpace, CommandThread } from "./command-contract";

export const COMMAND_LAYOUTS = [
  { id: "merged", label: "Merged", detail: "Final replies from every thread in one conversation." },
  { id: "grid", label: "Grid", detail: "Every thread side by side." },
  { id: "active", label: "Active", detail: "Working threads take the main area." },
  { id: "focus", label: "Focus", detail: "One selected thread at a time." },
] as const;
export type CommandLayout = typeof COMMAND_LAYOUTS[number]["id"];
export function commandLayout(value: unknown): CommandLayout {
  return COMMAND_LAYOUTS.some(layout => layout.id === value) ? value as CommandLayout : "grid";
}
export function threadActivity(thread: CommandThread) {
  if (thread.error) return "Unavailable";
  if (thread.hasPendingInteraction) return "Needs input";
  if (thread.status === "error") return "Failed";
  if (["active", "starting"].includes(thread.status)) return "Working";
  return "Idle";
}
export function activeThreads(threads: CommandThread[]) {
  return threads.filter(thread => ["Working", "Needs input"].includes(threadActivity(thread)));
}
export function focusedThread(threads: CommandThread[], selected: string | null) {
  return threads.find(thread => thread.id === selected) ?? activeThreads(threads)[0] ?? threads.find(thread => !thread.parentThreadId) ?? threads[0];
}
const ATTENTION = ["Needs input", "Failed", "Working", "Idle", "Unavailable"];
/** Threads that need the owner first, then working ones, then the most recently updated. */
export function byAttention(threads: CommandThread[]) {
  return [...threads].sort((a, b) => ATTENTION.indexOf(threadActivity(a)) - ATTENTION.indexOf(threadActivity(b)) || b.updatedAt - a.updatedAt);
}
/** Grid order: panes the owner arranged keep their places; the rest follow in attention order. */
export function arrangeGrid(threads: CommandThread[], order: string[]) {
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
/**
 * Active follows the work: every working thread in attention order, or what
 * it showed last when nothing works, with a thread the owner picked first.
 * With nothing to keep it shows the latest thread.
 */
export function followedThreads(threads: CommandThread[], pinned: string | null, previous: string[]) {
  const find = (id: string | null) => id ? threads.find(thread => thread.id === id) : undefined;
  const pick = find(pinned), working = byAttention(activeThreads(threads));
  const rest = (working.length ? working : previous.flatMap(id => find(id) ?? [])).filter(thread => thread !== pick);
  if (pick || rest.length) return [...(pick ? [pick] : []), ...rest];
  const latest = [...threads].filter(thread => !thread.parentThreadId && !thread.error).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? threads[0];
  return latest ? [latest] : [];
}
/**
 * Who a message goes to: every thread or bot it mentions, otherwise the
 * thread picked to reply to, otherwise the Space's lead.
 */
export function recipients(mentioned: string[], everyone: boolean, picked: string | null, space: CommandSpace) {
  const roots = space.threads.filter(thread => !thread.parentThreadId).map(thread => thread.id);
  if (everyone) return roots;
  if (mentioned.length) return [...new Set(mentioned)];
  if (picked && space.threads.some(thread => thread.id === picked)) return [picked];
  if (space.leadThreadId) return [space.leadThreadId];
  if (roots.length === 1) return roots;
  throw new Error("This Space has no lead. @mention a thread, or pick one to send to.");
}
