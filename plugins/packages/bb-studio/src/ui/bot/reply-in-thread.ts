import { relativeTime } from "../../kit/format";
import type { SideThreadView } from "../../contract";

const FOOTER = "data-studio-thread-footer";
const REFRESH_MS = 10_000;

export function threadInPath(pathname: string): string | null {
  return /\/threads\/([^/?#]+)/.exec(pathname)?.[1] ?? null;
}

export function sideThreadLabel(thread: Pick<SideThreadView, "replies" | "working" | "lastReplyAt">, now = Date.now()): string {
  const replies = thread.replies === 1 ? "1 reply" : `${thread.replies} replies`;
  if (thread.working) return thread.replies ? `${replies} · working…` : "Working…";
  if (!thread.replies) return "Thread";
  return thread.lastReplyAt ? `${replies} · ${relativeTime(thread.lastReplyAt, now)}` : replies;
}

export type Chat = { chat: boolean; threads: SideThreadView[] };

export interface ThreadFooter {
  key: string;
  host: HTMLElement;
  sourceThreadId: string;
  thread: SideThreadView;
}

const columnOf = (row: HTMLElement) => [...row.querySelectorAll<HTMLElement>("[data-message-column]")].find((each) => each.closest("[data-timeline-row-id]") === row);

export function isChatReply(row: HTMLElement, threadId: string): boolean {
  const id = row.getAttribute("data-timeline-row-id") ?? "";
  if (!id.startsWith(`${threadId}:`)) return false;
  if (id.startsWith(`${threadId}:assistant:`)) return true;
  return !!columnOf(row)?.classList.contains("group/message");
}

function makeFooter(): HTMLDivElement {
  const footer = document.createElement("div");
  footer.setAttribute(FOOTER, "");
  Object.assign(footer.style, { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px", margin: "4px 0 2px" } satisfies Partial<CSSStyleDeclaration>);
  return footer;
}

export function mountSideThreadRows(
  signal: AbortSignal,
  load: (threadId: string) => Promise<Chat>,
  show: (footers: readonly ThreadFooter[]) => void,
): void {
  const chats = new Map<string, { data: Chat; at: number }>();
  const loading = new Set<string>();
  const footers = new Map<HTMLElement, ThreadFooter>();
  let shown = "";
  let frame: number | undefined;
  let disposed = false;

  const fetchChat = (threadId: string) => {
    if (loading.has(threadId)) return;
    loading.add(threadId);
    void load(threadId)
      .then((data) => chats.set(threadId, { data, at: Date.now() }), () => chats.set(threadId, { data: { chat: false, threads: [] }, at: Date.now() }))
      .finally(() => { loading.delete(threadId); schedule(); });
  };

  const publish = () => {
    const list = [...footers.values()];
    const signature = `${Math.floor(Date.now() / 60_000)}|${list.map((each) => `${each.key}:${JSON.stringify(each.thread)}`).join("|")}`;
    if (signature === shown) return;
    shown = signature;
    show(list);
  };

  const sweep = () => {
    if (disposed) return;
    const threadId = threadInPath(location.pathname);
    const known = threadId ? chats.get(threadId) : undefined;
    if (threadId && (!known || (known.data.chat && Date.now() - known.at > REFRESH_MS))) fetchChat(threadId);
    const chat = known?.data.chat === true ? known.data : null;
    const byMessage = new Map((chat?.threads ?? []).map((thread) => [thread.messageId, thread]));
    for (const message of document.querySelectorAll<HTMLElement>("[data-timeline-row-id]")) {
      const host = [...message.querySelectorAll<HTMLElement>(`[${FOOTER}]`)].find((each) => each.closest("[data-timeline-row-id]") === message);
      const messageId = message.getAttribute("data-timeline-row-id") ?? "";
      const thread = chat && threadId && isChatReply(message, threadId) ? byMessage.get(messageId) : undefined;
      if (!thread || !threadId) {
        if (host) { footers.delete(host); host.remove(); }
        continue;
      }
      const footer = host ?? makeFooter();
      if (!host) (columnOf(message) ?? message).appendChild(footer);
      footers.set(footer, { key: messageId, host: footer, sourceThreadId: threadId, thread });
    }
    for (const host of [...footers.keys()]) if (!host.isConnected) footers.delete(host);
    publish();
  };
  const schedule = () => {
    if (disposed || frame !== undefined) return;
    frame = requestAnimationFrame(() => { frame = undefined; sweep(); });
  };
  const ours = (node: Node) => !!(node instanceof HTMLElement ? node : node.parentElement)?.closest(`[${FOOTER}]`) || (node instanceof HTMLElement && node.hasAttribute(FOOTER));
  const observer = new MutationObserver((records) => {
    if (records.every((record) => ours(record.target) || (record.addedNodes.length + record.removedNodes.length > 0 && [...record.addedNodes, ...record.removedNodes].every(ours)))) return;
    schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  const timer = setInterval(schedule, 1000);
  signal.addEventListener("abort", () => {
    disposed = true;
    observer.disconnect();
    clearInterval(timer);
    if (frame !== undefined) cancelAnimationFrame(frame);
    for (const host of footers.keys()) host.remove();
    footers.clear();
    show([]);
  }, { once: true });
  sweep();
}
