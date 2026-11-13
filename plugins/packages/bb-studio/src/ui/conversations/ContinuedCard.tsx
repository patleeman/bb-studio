import { useBbNavigate, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { useLayoutEffect, useRef } from "react";
import { conversationLink } from "../../continue-shared";
import { Icon } from "../../kit/app/index";
import { CHAT_CARD, CHAT_CARD_HEAD } from "../../kit/app/chat-card";
import { cn } from "../../kit/ui/index";
import { useLive } from "../live";

const THREAD_ID = /^[\w-]{3,200}$/;

export function fallbackAfter(start: Element, threadId: string): HTMLElement | null {
  const href = conversationLink(threadId);
  for (let node: Element | null = start; node; node = node.parentElement) {
    const next = node.nextElementSibling;
    if (!next) continue;
    if (!(next instanceof HTMLElement) || next.tagName !== "P") return null;
    const links = next.querySelectorAll("a");
    if (links.length !== 1 || links[0]!.getAttribute("href") !== href) return null;
    return next.textContent?.trim() === links[0]!.textContent?.trim() ? next : null;
  }
  return null;
}

export function ContinuedCard({ attributes }: PluginMessageDirectiveProps) {
  const threadId = attributes.to ?? "";
  const valid = THREAD_ID.test(threadId);
  const live = useLive("bot_thread_info", { threadId }, { enabled: valid, pollMs: 60_000 });
  const navigate = useBbNavigate();
  const ref = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (!valid || !ref.current) return;
    const fallback = fallbackAfter(ref.current, threadId);
    if (!fallback) return;
    fallback.hidden = true;
    return () => { fallback.hidden = false; };
  }, [valid, threadId]);
  if (!valid) return null;
  const info = live.data?.info ?? null;
  const title = info?.title || attributes.title || "New conversation";
  const status = info?.archivedAt ? "Archived" : info?.needsYou ? "Needs you" : null;
  return (
    <button ref={ref} type="button" data-studio-card="" data-testid="continued-card" data-thread={threadId} onClick={() => navigate.toThread(threadId)}
      className={cn(CHAT_CARD, "group cursor-pointer transition-colors hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none")}>
      <span data-studio-card-head="" className={cn(CHAT_CARD_HEAD, "w-full pr-3")}>
        <Icon name="MessageSquare" className="size-4 shrink-0 text-muted-foreground" />
        <span data-studio-card-title="" className="min-w-0 truncate text-sm font-medium text-foreground">Continued in <span data-testid="continued-title">{title}</span></span>
        <span data-studio-card-meta="" className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{status}</span>
        <Icon name="ArrowUpRight" className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
      </span>
    </button>
  );
}
