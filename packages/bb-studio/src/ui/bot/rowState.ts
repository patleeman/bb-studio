// What a sidebar row shows about its thread, most urgent first: a thread row
// in the Threads section (ThreadsSection.tsx), and a Bot's row in the Bots
// section (BotSidebar.tsx), which draws BB's own status glyph for it.
//
// A Bot's chat is a hidden thread. BB's live sidebar view
// (experimental_useSidebarThreads) leaves hidden threads out on stable BB
// 0.48 although the SDK says it carries them, so the row reads the chat from
// Studio's bot_attention (refreshed on thread.active and thread.idle) and
// also from the live view when it's there. Its row folds in:
// - needs you: the chat waits on an answer or approval, or Studio's
//   bot_attention has a pending question or a released todo for the user;
// - working: the chat is busy (bot_attention's `working`, or the live view),
//   a thread the chat spawned is (live view), or (on the selected Bot)
//   bot_activity counts threads in progress;
// - error: the chat's last turn failed (read or not, until a turn succeeds);
// - unread: a reply the user hasn't read. Read off bot_attention, not BB's
//   isUnread: BB marks the chat unread after every turn, including the
//   [PASS] a check-in ends with when nothing changed, which isn't news.
import type { PluginSidebarThread, PluginSidebarThreadIndicator } from "@get-bb/plugin-sdk/app";

export type ThreadState = "needs-you" | "working" | "error" | "unread" | "idle";

type StatusFields = Pick<PluginSidebarThread, "status" | "runtimeStatus" | "indicator" | "hasPendingInteraction" | "isUnread">;

const BUSY = new Set(["starting", "active", "stopping", "provisioning"]);

/** What a thread asks of the user, most urgent first. */
export function threadState(thread: StatusFields): ThreadState {
  if (thread.hasPendingInteraction || thread.indicator === "waiting-for-input") return "needs-you";
  if (isBusy(thread)) return "working";
  if (thread.indicator === "unread-error" || thread.status === "error" || thread.runtimeStatus === "error") return "error";
  if (thread.indicator === "unread-success" || thread.isUnread) return "unread";
  return "idle";
}

function isBusy(thread: Pick<PluginSidebarThread, "status" | "runtimeStatus" | "indicator">): boolean {
  return BUSY.has(thread.status) || BUSY.has(thread.runtimeStatus) || thread.indicator === "runtime";
}

/** Studio's bot_attention: `count` things wait in the chat, `unread` of them unread replies. */
export type BotAttentionSummary = { count: number; unread?: number } | null | undefined;

export function botRowState(input: {
  /** The Bot's chat in BB's live sidebar view; null while unknown or when it has none. */
  chat: StatusFields | null;
  /** Threads the chat spawned (live view): one working makes the Bot working. */
  children?: readonly Pick<PluginSidebarThread, "status" | "runtimeStatus" | "indicator">[];
  attention: BotAttentionSummary;
  /** bot_attention's `working`: the chat is busy. */
  chatWorking?: boolean;
  /** Threads in progress per bot_activity (the selected Bot only). */
  running?: number;
}): ThreadState {
  const chat = input.chat ? threadState(input.chat) : "idle";
  const unread = input.attention?.unread ?? 0;
  const waiting = (input.attention?.count ?? 0) - unread;
  if (chat === "needs-you" || waiting > 0) return "needs-you";
  if (chat === "working" || input.chatWorking || (input.running ?? 0) > 0 || (input.children ?? []).some(isBusy)) return "working";
  if (chat === "error") return "error";
  if (unread > 0) return "unread";
  return "idle";
}

/** BB's status glyph for each state, the one its own thread rows draw. */
export const STATE_INDICATOR: Record<ThreadState, PluginSidebarThreadIndicator> = {
  "needs-you": "waiting-for-input",
  working: "runtime",
  error: "unread-error",
  unread: "unread-success",
  idle: "none",
};
