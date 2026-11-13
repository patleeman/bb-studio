import { useBbNavigate, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { useLayoutEffect, useRef } from "react";
import { conversationLink } from "../../continue-shared";
import { Icon } from "../../kit/app/index";
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
    <button ref={ref} type="button" data-testid="continued-card" data-thread={threadId} onClick={() => navigate.toThread(threadId)}
      className="studio-root my-2 flex w-full max-w-xl cursor-pointer items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 text-left text-sm transition-colors hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
      <Icon name="MessageSquare" className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-xs text-muted-foreground">Continued in</span>
        <span data-testid="continued-title" className="truncate font-semibold text-foreground">{title}</span>
      </span>
      {status ? <span className="shrink-0 text-xs text-muted-foreground">{status}</span> : null}
      <Icon name="ArrowRight" className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
