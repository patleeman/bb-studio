// "Reply in thread" in a Bot reply's action bar (src/bot-side-threads.ts):
// it works on every reply, old ones included, where the `::bot-thread{}` row
// needs the Bot to have written the marker. BB registers message actions for
// every thread and both roles, so a content script hides the button
// everywhere but a Bot chat's replies, as the reactions do (their
// action-decoration.ts). BB draws the button's icon itself (no plugin icon
// asset), so it's found by its aria-label, which no BB action shares.

/** The action's title, which is also its button's aria-label. */
export const REPLY_IN_THREAD_TITLE = "Reply in thread";

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

/**
 * Hides "Reply in thread" except on a Bot chat's replies. Whether the page's
 * thread is a Bot chat is asked once per thread (bot_side_threads' `chat`);
 * until it's known the button stays hidden. Restores what it hid on abort.
 */
export function mountReplyInThreadVisibility(signal: AbortSignal, isChat: (threadId: string) => Promise<boolean> = async (threadId) => (await rpc<{ chat: boolean }>("bot_side_threads", { threadId })).chat): void {
  const chats = new Map<string, boolean>();
  const asking = new Set<string>();
  const hidden = new Set<HTMLElement>();
  let frame: number | undefined;
  let disposed = false;

  const sweep = () => {
    if (disposed) return;
    const threadId = threadInPath(location.pathname);
    if (threadId && !chats.has(threadId) && !asking.has(threadId)) {
      asking.add(threadId);
      void isChat(threadId).then((chat) => chats.set(threadId, chat), () => chats.set(threadId, false)).finally(() => { asking.delete(threadId); schedule(); });
    }
    const chat = threadId ? chats.get(threadId) === true : false;
    for (const button of document.querySelectorAll<HTMLButtonElement>(`button[aria-label="${REPLY_IN_THREAD_TITLE}"]`)) {
      const show = chat && roleOf(button) !== "user";
      if (show && hidden.has(button)) { button.style.removeProperty("display"); hidden.delete(button); }
      if (!show && !hidden.has(button)) { button.style.display = "none"; hidden.add(button); }
    }
    for (const button of hidden) if (!button.isConnected) hidden.delete(button);
  };
  const schedule = () => {
    if (disposed || frame !== undefined) return;
    frame = requestAnimationFrame(() => { frame = undefined; sweep(); });
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  // Moving between threads changes the page without touching these buttons.
  const timer = setInterval(schedule, 1000);
  signal.addEventListener("abort", () => {
    disposed = true;
    observer.disconnect();
    clearInterval(timer);
    if (frame !== undefined) cancelAnimationFrame(frame);
    for (const button of hidden) button.style.removeProperty("display");
    hidden.clear();
  }, { once: true });
  sweep();
}
