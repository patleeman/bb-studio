// "2 replies · 5m" under each Bot reply with side threads (src/bot-side-threads.ts),
// drawn by Studio rather than by anything the Bot writes. BB marks each
// message with data-timeline-row-id, which is the message id side threads are
// keyed by, and content scripts are where decorating BB's own page belongs.
// Starting a side thread is BB's own "Reply in side chat". A row's click asks
// Studio's app overlay to open the side thread beside the chat
// (OPEN_SIDE_THREAD_EVENT; content scripts can't navigate).
import { relativeTime } from "@bb-studio/kit/format";
import type { SideThreadView } from "../../contract";

/** A row's click: `detail.threadId` is the side thread to open (SideThreadOpener). */
export const OPEN_SIDE_THREAD_EVENT = "studio:open-side-thread";
const ROW = "data-studio-side-thread";
/** How often an open Bot chat's side threads are fetched again. */
const REFRESH_MS = 10_000;

async function rpc<T>(method: string, input: unknown): Promise<T> {
  const response = await fetch(`/api/v1/plugins/studio/rpc/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  const body = await response.json().catch(() => null) as { ok?: boolean; result?: T; error?: { message?: string } } | null;
  if (!body?.ok) throw new Error(body?.error?.message ?? "Studio couldn't do that.");
  return body.result as T;
}

/** The thread the page shows: /threads/<id>, or a project's /projects/<p>/threads/<id>. */
export function threadInPath(pathname: string): string | null {
  return /\/threads\/([^/?#]+)/.exec(pathname)?.[1] ?? null;
}

/** "2 replies · 5m ago", "1 reply · working…", "Thread" before any reply. */
export function sideThreadLabel(thread: SideThreadView, now = Date.now()): string {
  const replies = thread.replies === 1 ? "1 reply" : `${thread.replies} replies`;
  if (thread.working) return thread.replies ? `${replies} · working…` : "Working…";
  if (!thread.replies) return "Thread";
  return thread.lastReplyAt ? `${replies} · ${relativeTime(thread.lastReplyAt, now)}` : replies;
}

type Chat = { chat: boolean; threads: SideThreadView[] };

/** The row under a reply: a quiet link in the accent color, BB's own classes avoided. */
function makeRow(): HTMLButtonElement {
  const row = document.createElement("button");
  row.type = "button";
  row.setAttribute(ROW, "");
  Object.assign(row.style, {
    display: "inline-flex", alignItems: "center", gap: "6px", margin: "4px 0 2px", padding: "2px 6px", border: "0", borderRadius: "6px",
    background: "transparent", color: "var(--primary, currentColor)", font: "inherit", fontSize: "12px", fontWeight: "500", cursor: "pointer",
  } satisfies Partial<CSSStyleDeclaration>);
  row.addEventListener("mouseenter", () => { row.style.background = "color-mix(in oklab, currentColor 10%, transparent)"; });
  row.addEventListener("mouseleave", () => { row.style.background = "transparent"; });
  return row;
}

/**
 * Keeps a reply-count row under each Bot reply with side threads. Asks the
 * plugin about the page's thread (bot_side_threads), and again every few
 * seconds while it's a Bot's chat. Removes its rows on abort.
 */
export function mountSideThreadRows(
  signal: AbortSignal,
  load: (threadId: string) => Promise<Chat> = (threadId) => rpc<Chat>("bot_side_threads", { threadId }),
): void {
  const chats = new Map<string, { data: Chat; at: number }>();
  const loading = new Set<string>();
  const rows = new Set<HTMLElement>();
  let frame: number | undefined;
  let disposed = false;

  const fetchChat = (threadId: string) => {
    if (loading.has(threadId)) return;
    loading.add(threadId);
    void load(threadId)
      .then((data) => chats.set(threadId, { data, at: Date.now() }), () => chats.set(threadId, { data: { chat: false, threads: [] }, at: Date.now() }))
      .finally(() => { loading.delete(threadId); schedule(); });
  };

  const sweep = () => {
    if (disposed) return;
    const threadId = threadInPath(location.pathname);
    const known = threadId ? chats.get(threadId) : undefined;
    if (threadId && (!known || (known.data.chat && Date.now() - known.at > REFRESH_MS))) fetchChat(threadId);
    const chat = known?.data.chat === true ? known.data : null;

    const byMessage = new Map((chat?.threads ?? []).map((thread) => [thread.messageId, thread]));
    const now = Date.now();
    for (const message of document.querySelectorAll<HTMLElement>("[data-timeline-row-id]")) {
      const thread = byMessage.get(message.getAttribute("data-timeline-row-id") ?? "");
      let row = message.querySelector<HTMLButtonElement>(`:scope > [${ROW}], :scope [${ROW}]`);
      if (!thread) { if (row) { row.remove(); rows.delete(row); } continue; }
      if (!row) {
        row = makeRow();
        row.addEventListener("click", () => {
          const sideThread = row!.getAttribute("data-thread");
          if (sideThread) window.dispatchEvent(new CustomEvent(OPEN_SIDE_THREAD_EVENT, { detail: { threadId: sideThread } }));
        });
        (message.querySelector("[data-message-column]") ?? message).appendChild(row);
        rows.add(row);
      }
      row.setAttribute("data-thread", thread.threadId);
      const label = `💬 ${sideThreadLabel(thread, now)}`;
      if (row.textContent !== label) row.textContent = label;
    }
    for (const row of rows) if (!row.isConnected) rows.delete(row);
  };
  const schedule = () => {
    if (disposed || frame !== undefined) return;
    frame = requestAnimationFrame(() => { frame = undefined; sweep(); });
  };
  const observer = new MutationObserver((records) => {
    // Our own rows changing isn't news.
    if (records.every((record) => [...record.addedNodes, ...record.removedNodes].every((node) => node instanceof HTMLElement && node.hasAttribute(ROW)) && record.addedNodes.length + record.removedNodes.length > 0)) return;
    schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  // Moving between threads, new replies counted and ages ticking: a slow beat.
  const timer = setInterval(schedule, 1000);
  signal.addEventListener("abort", () => {
    disposed = true;
    observer.disconnect();
    clearInterval(timer);
    if (frame !== undefined) cancelAnimationFrame(frame);
    for (const row of rows) row.remove();
    rows.clear();
  }, { once: true });
  sweep();
}
