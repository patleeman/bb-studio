// Side threads in a Bot chat on the desktop, drawn by Studio itself rather
// than by anything the Bot writes (src/bot-side-threads.ts):
//
// - "Reply in thread" in each Bot reply's action bar, a message action. BB
//   registers message actions for every thread and both roles, so this
//   content script hides the button everywhere but a Bot chat's replies, as
//   the reactions do (their action-decoration.ts). BB draws the button's icon
//   itself (no plugin icon asset), so it's found by its aria-label, which no
//   BB action shares.
// - "2 replies · 5m" under each reply that has a side thread. BB marks each
//   message with data-timeline-row-id, which is the message id side threads
//   are keyed by, and content scripts are where decorating BB's own page
//   belongs. The row opens the side thread by pressing the reply's own
//   "Reply in thread", which opens the existing one.
import { relativeTime } from "@bb-studio/kit/format";
import type { SideThreadView } from "../../contract";

/** The action's title, which is also its button's aria-label. */
export const REPLY_IN_THREAD_TITLE = "Reply in thread";
const ACTION = `button[aria-label="${REPLY_IN_THREAD_TITLE}"]`;
const ROW = "data-studio-side-thread";
/** How often an open Bot chat's side threads are fetched again. */
const REFRESH_MS = 10_000;

async function rpc<T>(method: string, input: unknown): Promise<T> {
  const response = await fetch(`/api/v1/plugins/studio/rpc/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  const body = await response.json().catch(() => null) as { ok?: boolean; result?: T; error?: { message?: string } } | null;
  if (!body?.ok) throw new Error(body?.error?.message ?? "Studio couldn't do that.");
  return body.result as T;
}

/** Opens (or starts) a reply's side thread; its thread id. */
export async function openSideThread(threadId: string, messageId: string): Promise<string> {
  return (await rpc<{ threadId: string }>("bot_side_thread_open", { threadId, messageId })).threadId;
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

/** A message action button's role, from the message around it (the reactions' roleOf). */
function roleOf(button: Element): "assistant" | "user" | null {
  for (let node: Element | null = button.parentElement, depth = 0; node && depth < 10; node = node.parentElement, depth++) {
    for (const attribute of ["data-role", "data-message-role", "data-conversation-role", "data-testid"]) {
      const role = node.getAttribute(attribute)?.toLowerCase();
      if (role === "assistant" || role === "assistant-message" || role === "message-assistant") return "assistant";
      if (role === "user" || role === "user-message" || role === "message-user") return "user";
    }
    if (node.classList.contains("group/message")) {
      if (node.classList.contains("ml-auto")) return "user";
      if (node.classList.contains("w-full")) return "assistant";
    }
  }
  return null;
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
 * Keeps a Bot chat's side threads on screen: "Reply in thread" only on its
 * replies, and a reply-count row under each reply with a side thread. Asks
 * the plugin about the page's thread (bot_side_threads) and again every few
 * seconds; until it knows, the action stays hidden. Undoes everything on abort.
 */
export function mountSideThreadRows(
  signal: AbortSignal,
  load: (threadId: string) => Promise<Chat> = (threadId) => rpc<Chat>("bot_side_threads", { threadId }),
  open: (threadId: string, messageId: string) => Promise<unknown> = openSideThread,
): void {
  const chats = new Map<string, { data: Chat; at: number }>();
  const loading = new Set<string>();
  const hidden = new Set<HTMLElement>();
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

    for (const button of document.querySelectorAll<HTMLButtonElement>(ACTION)) {
      const show = !!chat && roleOf(button) !== "user";
      if (show && hidden.has(button)) { button.style.removeProperty("display"); hidden.delete(button); }
      if (!show && !hidden.has(button)) { button.style.display = "none"; hidden.add(button); }
    }
    for (const button of hidden) if (!button.isConnected) hidden.delete(button);

    const byMessage = new Map((chat?.threads ?? []).map((thread) => [thread.messageId, thread]));
    const now = Date.now();
    for (const message of document.querySelectorAll<HTMLElement>("[data-timeline-row-id]")) {
      const thread = byMessage.get(message.getAttribute("data-timeline-row-id") ?? "");
      let row = message.querySelector<HTMLButtonElement>(`:scope > [${ROW}], :scope [${ROW}]`);
      if (!thread) { if (row) { row.remove(); rows.delete(row); } continue; }
      if (!row) {
        row = makeRow();
        const messageId = message.getAttribute("data-timeline-row-id")!;
        // The reply's own action opens the side thread beside the chat; without one, Studio opens it.
        row.addEventListener("click", () => {
          const action = message.querySelector<HTMLButtonElement>(ACTION);
          if (action) action.click();
          else if (threadId) void open(threadId, messageId);
        });
        (message.querySelector("[data-message-column]") ?? message).appendChild(row);
        rows.add(row);
      }
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
    for (const button of hidden) button.style.removeProperty("display");
    for (const row of rows) row.remove();
    hidden.clear();
    rows.clear();
  }, { once: true });
  sweep();
}
