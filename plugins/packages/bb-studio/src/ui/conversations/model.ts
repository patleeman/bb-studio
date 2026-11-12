// The Bot sidebar's rules (round 6, with the brief's switcher), pure so they
// are tested directly (model.test.ts): the space dots at the bottom, which
// Bot a switch goes to, where the main view lands after a switch, and the
// rows: the server's view (bot_threads_view) with BB's live thread state on
// top, so a spinner or a question shows the moment BB knows.
import type { PluginThreadActionTarget } from "@get-bb/plugin-sdk/app";
import type { BotSpace, ConversationRow, WorkerRow } from "../../bot-threads-contract";

/** What BB's live sidebar view says about a thread (experimental_useSidebarThreads). */
export interface LiveThread {
  id: string;
  status?: string;
  runtimeStatus?: string;
  queuedMessageCount?: number;
  hasPendingInteraction?: boolean;
  updatedAt?: number;
  displayTitle?: string;
}

const BUSY = new Set(["starting", "active", "stopping", "provisioning", "pending"]);
const idlePending = (thread: LiveThread) => thread.status === "pending" && !((thread.queuedMessageCount ?? 0) > 0);
const isBusy = (thread: LiveThread | undefined) => !!thread && !idlePending(thread) && (BUSY.has(thread.status ?? "") || BUSY.has(thread.runtimeStatus ?? ""));

export interface SpaceDot {
  id: string;
  name: string;
  active: boolean;
  /** That Bot has a conversation that needs Patrick. */
  amber: boolean;
  /** "Chief of Staff, needs you" for the dot's label. */
  label: string;
  /** Its number for "Studio: Show Bot <n>" (Ctrl+Option+<n>), for the first nine. */
  shortcut: number | null;
}

/** One dot per Bot, in order; the current one filled, amber when that Bot needs Patrick. */
export function spaceDots(bots: readonly Pick<BotSpace, "id" | "name" | "needsYou">[], currentId: string | null): SpaceDot[] {
  const current = bots.some((bot) => bot.id === currentId) ? currentId : bots[0]?.id ?? null;
  return bots.map((bot, index) => ({
    id: bot.id, name: bot.name, active: bot.id === current, amber: bot.needsYou,
    label: `${bot.name}${bot.needsYou ? ", needs you" : ""}${bot.id === current ? " (shown)" : ""}`,
    shortcut: index < 9 ? index + 1 : null,
  }));
}

/** The Bot a switch goes to: by number (Ctrl+Option+1…9, from 1) or a step left or right. Null: nowhere (no wrap). */
export function switchTarget(bots: readonly { id: string }[], currentId: string | null, move: { index: number } | { step: -1 | 1 }): string | null {
  if (!bots.length) return null;
  if ("index" in move) return bots[move.index - 1]?.id ?? null;
  const at = Math.max(0, bots.findIndex((bot) => bot.id === currentId));
  const next = bots[at + move.step];
  return next && next.id !== currentId ? next.id : null;
}

/** A two-finger swipe: horizontal wheel movement adds up until it passes this. */
export const SWIPE_THRESHOLD = 90;
/** Movement stops for this long: the gesture is over and the next one can switch again. */
export const SWIPE_IDLE_MS = 350;

export interface SwipeState { total: number; fired: boolean; lastAt: number }
export const SWIPE_START: SwipeState = { total: 0, fired: false, lastAt: 0 };

/**
 * Adds one wheel event to the gesture. Answers the step to take (one Bot to
 * the right for a leftward swipe of the content, as in Arc) and the state
 * after it. A mostly vertical wheel is scrolling, not a swipe. One switch per
 * gesture.
 */
export function swipeStep(state: SwipeState, event: { deltaX: number; deltaY: number; at: number }): { state: SwipeState; step: -1 | 1 | null } {
  const fresh = event.at - state.lastAt > SWIPE_IDLE_MS ? SWIPE_START : state;
  if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return { state: { ...fresh, lastAt: event.at }, step: null };
  const total = fresh.total + event.deltaX;
  if (fresh.fired || Math.abs(total) < SWIPE_THRESHOLD) return { state: { total, fired: fresh.fired, lastAt: event.at }, step: null };
  return { state: { total: 0, fired: true, lastAt: event.at }, step: total > 0 ? 1 : -1 };
}

/** Where the main view goes after switching to a Bot: its last-open conversation while it is listed, else Main. */
export function landingThread(space: Pick<BotSpace, "mainThreadId"> | null | undefined, last: string | null, listed: ReadonlySet<string> | null): string | null {
  if (last && (!listed || listed.has(last))) return last;
  return space?.mainThreadId ?? null;
}

export interface ConversationLine extends ConversationRow {
  /** The row of the thread in the main view. */
  selected: boolean;
}

/**
 * The conversations with BB's live state on top: running now, or its own
 * question. A thread mirrored from bb keeps the server's state: it is bb's,
 * and the live view only knows the idle copy here.
 */
export function conversationLines(rows: readonly ConversationRow[], live: ReadonlyMap<string, LiveThread>, activeThreadId: string | null): ConversationLine[] {
  return rows.map((row) => {
    const thread = row.mirrored ? undefined : live.get(row.threadId);
    const needsYou = row.needsYou ?? (thread?.hasPendingInteraction ? { reason: "Asked you a question", at: thread.updatedAt ?? row.updatedAt } : null);
    // BB's updatedAt counts only while it works: the importer moves it without any use.
    return { ...row, running: thread ? isBusy(thread) : row.running, needsYou, updatedAt: isBusy(thread) ? Math.max(row.updatedAt, thread?.updatedAt ?? 0) : row.updatedAt, selected: row.threadId === activeThreadId };
  });
}

export interface WorkerLine extends WorkerRow { selected: boolean }

/**
 * Workers with BB's live state on top (a hidden worker isn't in BB's view:
 * the server's state stays; so does a mirrored one's, which is bb's).
 */
export function workerLines(rows: readonly WorkerRow[], live: ReadonlyMap<string, LiveThread>, activeThreadId: string | null): WorkerLine[] {
  return rows.map((row) => {
    const thread = row.mirrored ? undefined : live.get(row.threadId);
    const status = !thread ? row.status : thread.hasPendingInteraction ? "needs-you" : isBusy(thread) ? "running" : thread.status === "error" ? "failed" : row.status === "running" || row.status === "needs-you" ? "done" : row.status;
    return { ...row, status, selected: row.threadId === activeThreadId };
  });
}

export function hiddenThreadTarget(row: { threadId: string; projectId: string | null }, state: "running" | "failed" | "idle"): PluginThreadActionTarget | null {
  if (!row.projectId) return null;
  return {
    id: row.threadId, projectId: row.projectId, parentThreadId: null, parentNotifications: "auto", archivedAt: null, pinnedAt: null, sectionId: null, isUnread: false,
    status: state === "running" ? "active" : state === "failed" ? "error" : "idle", environment: null,
  };
}

const MINUTE = 60_000;
/** "now", "4m", "2h", "3d", "5w": a row's time. */
export function shortAge(at: number, now: number): string {
  const ms = Math.max(0, now - at);
  if (ms < MINUTE) return "now";
  if (ms < 60 * MINUTE) return `${Math.floor(ms / MINUTE)}m`;
  if (ms < 24 * 60 * MINUTE) return `${Math.floor(ms / (60 * MINUTE))}h`;
  if (ms < 7 * 24 * 60 * MINUTE) return `${Math.floor(ms / (24 * 60 * MINUTE))}d`;
  return `${Math.floor(ms / (7 * 24 * 60 * MINUTE))}w`;
}

/** A conversation's second line: why it needs Patrick, else its latest reply, else what it is doing. */
export function secondLine(row: Pick<ConversationLine, "needsYou" | "latest" | "running">): { tone: "needs-you" | "running" | "quiet"; text: string } {
  if (row.needsYou) return { tone: "needs-you", text: `Needs you: ${row.needsYou.reason}` };
  if (row.running) return { tone: "running", text: row.latest || "Working…" };
  return { tone: "quiet", text: row.latest ?? "" };
}

/**
 * Workers split for the sidebar and the line above a conversation's
 * composer: the active ones (needing Patrick first, then running) shown one
 * by one, and the rest (done, failed) folded into one "N done".
 */
export function splitWorkers<Worker extends { status: WorkerRow["status"] }>(workers: readonly Worker[]): { active: Worker[]; done: Worker[] } {
  const needs = workers.filter((worker) => worker.status === "needs-you");
  const running = workers.filter((worker) => worker.status === "running");
  return { active: [...needs, ...running], done: workers.filter((worker) => worker.status !== "needs-you" && worker.status !== "running") };
}

/** "3 done": the folded workers' row or chip. */
export const doneLabel = (count: number): string => `${count} done`;

export interface SummarySection {
  /** "Decisions", "Left open", "Made"; "" for text before the first heading. */
  heading: string;
  items: string[];
  /** The items were bullets. */
  list: boolean;
}

const inline = (text: string) => text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();

/**
 * A finished conversation's summary as the card shows it: sections under a
 * bold line or a heading ("**Decisions**", "## Left open"), each with its
 * bullets, paragraphs or quoted lines. Plain text, no markdown rendering.
 */
export function summarySections(markdown: string): SummarySection[] {
  const sections: SummarySection[] = [];
  let current: SummarySection | null = null;
  const open = (heading: string) => { current = { heading, items: [], list: false }; sections.push(current); return current; };
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const heading = /^(?:#{1,6}\s+(.+?)|\*\*([^*]+?)\*\*:?)\s*(?:\((.*)\))?$/.exec(line);
    if (heading) { open(inline(heading[1] ?? heading[2] ?? "")); continue; }
    const section: SummarySection = current ?? open("");
    const bullet = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    const quote = /^>\s?(.*)$/.exec(line);
    if (bullet) { section.items.push(inline(bullet[1]!)); section.list = true; }
    else if (quote) { if (quote[1]!.trim()) section.items.push(inline(quote[1]!)); }
    else section.items.push(inline(line));
  }
  return sections.filter((section) => section.items.length || section.heading);
}

/** "N older conversations" / "N older workers": the quiet last row of each list. */
export function olderLabel(count: number, noun: "conversation" | "worker"): string | null {
  return count > 0 ? `${count} older ${noun}${count === 1 ? "" : "s"}` : null;
}

/** Whether the main view shows the older conversations and workers (its sidebar row is then selected). */
export const isOlderPage = (pathname: string): boolean => /^\/plugins\/studio\/studio\/conversations(?:\/|$)/.test(pathname);

/** A failure is history after this long: grey on the older list, not red. */
export const STALE_FAILURE_MS = 7 * 24 * 60 * 60_000;
export const staleFailure = (row: Pick<WorkerRow, "status" | "updatedAt">, now: number): boolean => row.status === "failed" && now - row.updatedAt > STALE_FAILURE_MS;

/** The page's address under the Studio panel. */
export const OLDER_SUBPATH = "conversations";
export const olderPath = (botId: string | null) => `${OLDER_SUBPATH}${botId ? `/${encodeURIComponent(botId)}` : ""}`;

/** The Bot a `conversations/<botId>` route names, or null. */
export function olderBotFromPath(path: string): string | null {
  const match = /^conversations\/([^/?#]+)/.exec(path.replace(/^\/+/, ""));
  if (!match) return null;
  try { return decodeURIComponent(match[1]!); } catch { return null; }
}
