import type { CommandSpace, CommandThread } from "./command-contract";

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
const ATTENTION = ["Needs input", "Failed", "Working", "Idle", "Unavailable"];
/** Threads that need the owner first, then working ones, then the most recently updated. */
export function byAttention(threads: CommandThread[]) {
  return [...threads].sort((a, b) => ATTENTION.indexOf(threadActivity(a)) - ATTENTION.indexOf(threadActivity(b)) || b.updatedAt - a.updatedAt);
}
/** Moves `id` to just before or after `target` in the visible ids. */
export function movePane(ids: string[], id: string, target: string, place: "before" | "after") {
  if (id === target || !ids.includes(id) || !ids.includes(target)) return ids;
  const rest = ids.filter(other => other !== id);
  const at = rest.indexOf(target) + (place === "after" ? 1 : 0);
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}
/**
 * The thread a lone pane follows: the one it shows while that keeps working,
 * else the thread that most needs the owner, else what it showed, else the
 * lead, else the latest.
 */
export function followThread(threads: CommandThread[], current: string | null, leadThreadId: string | null) {
  const find = (id: string | null) => id ? threads.find(thread => thread.id === id) : undefined;
  const now = find(current);
  if (now && activeThreads([now]).length) return now;
  return byAttention(activeThreads(threads))[0] ?? now ?? find(leadThreadId) ?? byAttention(threads.filter(thread => !thread.parentThreadId && !thread.error))[0] ?? threads[0];
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

/** BB's own New thread keys (⌘N, ⌘⇧O), which file the thread in this Space while Command is open. */
export const isNewThreadKey = (event: KeyboardEvent) => (event.metaKey || event.ctrlKey) && !event.altKey && (event.key.toLowerCase() === "n" ? !event.shiftKey : event.key.toLowerCase() === "o" && event.shiftKey);

/**
 * Whether this Command view takes a New thread key press from BB: only while
 * it's the view in use, with focus inside it (or, with nothing focused, the
 * last click landed in it), it's visible, and no dialog is open. A view kept
 * mounted in another split or a hidden tab leaves the key to BB. A key that
 * is part of an IME composition is never taken.
 */
export function claimsNewThreadKey(event: KeyboardEvent, root: Element | null, clickedInside: boolean) {
  if (!root || event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229 || !isNewThreadKey(event)) return false;
  const doc = root.ownerDocument;
  if (root.closest("[hidden], [inert], [aria-hidden='true']") || (typeof root.checkVisibility === "function" && !root.checkVisibility())) return false;
  if (doc.querySelector('[role="dialog"], [role="alertdialog"]')) return false;
  const active = doc.activeElement;
  return active && active !== doc.body && active !== doc.documentElement ? root.contains(active) : clickedInside;
}
