import type { SideThreadView } from "../../contract";

const FOOTER = "data-studio-thread-footer";
const REFRESH_MS = 10_000;

export function threadInPath(pathname: string): string | null {
  return /\/threads\/([^/?#]+)/.exec(pathname)?.[1] ?? null;
}

export function replyTime(at: number, now = Date.now(), locale?: string): string {
  const when = new Date(at);
  const today = new Date(now);
  if (when.toDateString() === today.toDateString()) return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(when);
  const sameYear = when.getFullYear() === today.getFullYear();
  return new Intl.DateTimeFormat(locale, sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" }).format(when);
}

export function sideThreadLabel(thread: Pick<SideThreadView, "replies" | "working" | "lastReplyAt" | "kind" | "conversations">, now = Date.now(), locale?: string): string | null {
  if (thread.kind === "fork") return `Forked here · ${thread.conversations === 1 ? "1 conversation" : `${thread.conversations} conversations`}`;
  if (thread.working) return "Replying…";
  if (!thread.replies) return null;
  const replies = thread.replies === 1 ? "1 reply" : `${thread.replies} replies`;
  return thread.lastReplyAt ? `${replies} · Last reply ${replyTime(thread.lastReplyAt, now, locale)}` : replies;
}

export type Chat = { chat: boolean; threads: SideThreadView[] };

export interface ThreadFooter {
  key: string;
  host: HTMLElement;
  sourceThreadId: string;
  threads: SideThreadView[];
}

const columnOf = (row: HTMLElement) => [...row.querySelectorAll<HTMLElement>("[data-message-column]")].find((each) => each.closest("[data-timeline-row-id]") === row);

export function isChatReply(row: HTMLElement, threadId: string): boolean {
  const id = row.getAttribute("data-timeline-row-id") ?? "";
  if (!id.startsWith(`${threadId}:`)) return false;
  if (id.startsWith(`${threadId}:assistant:`)) return true;
  return !!columnOf(row)?.classList.contains("group/message");
}

export function isOwnMessage(row: HTMLElement, threadId: string): boolean {
  const id = row.getAttribute("data-timeline-row-id") ?? "";
  if (!id.startsWith(`${threadId}:`) || isChatReply(row, threadId)) return false;
  return [...row.querySelectorAll<HTMLElement>(".group\\/message")].some((each) => each.closest("[data-timeline-row-id]") === row);
}

function makeFooter(end: boolean): HTMLDivElement {
  const footer = document.createElement("div");
  footer.setAttribute(FOOTER, "");
  Object.assign(footer.style, { display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: "12px", rowGap: "2px", margin: "2px 0 0" } satisfies Partial<CSSStyleDeclaration>);
  if (end) footer.style.justifyContent = "flex-end";
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
  let lastPath = "";

  const fetchChat = (threadId: string) => {
    if (loading.has(threadId)) return;
    loading.add(threadId);
    void load(threadId)
      .then((data) => chats.set(threadId, { data, at: Date.now() }), () => chats.set(threadId, { data: { chat: false, threads: [] }, at: Date.now() }))
      .finally(() => { loading.delete(threadId); schedule(); });
  };

  const publish = () => {
    const list = [...footers.values()];
    const signature = `${Math.floor(Date.now() / 60_000)}|${list.map((each) => `${each.key}:${JSON.stringify(each.threads)}`).join("|")}`;
    if (signature === shown) return;
    shown = signature;
    show(list);
  };

  const sweep = () => {
    if (disposed) return;
    lastPath = location.pathname;
    const threadId = threadInPath(lastPath);
    const known = threadId ? chats.get(threadId) : undefined;
    if (threadId && (!known || (known.data.chat && Date.now() - known.at > REFRESH_MS))) fetchChat(threadId);
    const chat = known?.data.chat === true ? known.data : null;
    if (!chat?.threads.length || !threadId) {
      if (footers.size > 0) {
        for (const host of footers.keys()) host.remove();
        footers.clear();
      }
      publish();
      return;
    }
    const byMessage = new Map<string, SideThreadView[]>();
    for (const thread of chat.threads) {
      const existing = byMessage.get(thread.messageId);
      if (existing) existing.push(thread);
      else byMessage.set(thread.messageId, [thread]);
    }
    const kept = new Set<HTMLElement>();
    for (const [messageId, all] of byMessage) {
      const selector = `[data-timeline-row-id="${messageId.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
      for (const message of document.querySelectorAll<HTMLElement>(selector)) {
        const host = [...message.querySelectorAll<HTMLElement>(`[${FOOTER}]`)].find((each) => each.closest("[data-timeline-row-id]") === message);
        const own = isOwnMessage(message, threadId);
        const threads = isChatReply(message, threadId) ? all
          : own ? all.filter((thread) => thread.kind === "fork") : undefined;
        if (!threads?.length) {
          if (host) { footers.delete(host); host.remove(); }
          continue;
        }
        const footer = host ?? makeFooter(own);
        if (!host) (columnOf(message) ?? message).appendChild(footer);
        footers.set(footer, { key: messageId, host: footer, sourceThreadId: threadId, threads });
        kept.add(footer);
      }
    }
    for (const host of [...footers.keys()]) {
      if (!kept.has(host) || !host.isConnected) {
        footers.delete(host);
        if (host.isConnected) host.remove();
      }
    }
    publish();
  };
  const schedule = () => {
    if (disposed || frame !== undefined) return;
    frame = requestAnimationFrame(() => { frame = undefined; sweep(); });
  };
  const ours = (node: Node) => !!(node instanceof HTMLElement ? node : node.parentElement)?.closest(`[${FOOTER}]`) || (node instanceof HTMLElement && node.hasAttribute(FOOTER));
  const hasElementNode = (list: NodeList) => {
    for (let i = 0; i < list.length; i += 1) if (list[i]!.nodeType === 1) return true;
    return false;
  };
  const observer = new MutationObserver((records) => {
    if (records.every((record) => (!hasElementNode(record.addedNodes) && !hasElementNode(record.removedNodes)) || ours(record.target) || (record.addedNodes.length + record.removedNodes.length > 0 && [...record.addedNodes, ...record.removedNodes].every(ours)))) return;
    const path = location.pathname;
    const threadId = threadInPath(path);
    const known = threadId ? chats.get(threadId) : undefined;
    if (path === lastPath && !footers.size && (!known || !known.data.chat || !known.data.threads.length)) return;
    schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  const timer = setInterval(() => {
    if (document.visibilityState === "hidden") return;
    const path = location.pathname;
    const threadId = threadInPath(path);
    const known = threadId ? chats.get(threadId) : undefined;
    const needsFetch = !!threadId && (!known || (known.data.chat && Date.now() - known.at > REFRESH_MS));
    if (path === lastPath && !needsFetch && !footers.size) return;
    schedule();
  }, 1000);
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
