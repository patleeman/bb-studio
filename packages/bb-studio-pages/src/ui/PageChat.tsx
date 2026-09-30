import {
  experimental_NewThreadComposer as NewThreadComposer,
  ThreadChat,
  ThreadTitle,
  useBbNavigate,
} from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { PageMetaView } from "../contract";
import type { Rpc } from "./shared";

/**
 * - `closed`: only the "Work with this page…" bar.
 * - `compose`: BB's new-thread composer, seeded with the page's project.
 * - `thread`: the current chat in a card above the bar's place.
 * - `minimized`: the chat's header above the bar.
 */
export type ChatMode = "closed" | "compose" | "thread" | "minimized";

const CARD = "pointer-events-auto flex flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl";
const HEADER_BUTTON = "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground";

export function PageChat({
  page,
  rpc,
  threadId,
  mode,
  onMode,
  onStarted,
  besideComments,
}: {
  page: PageMetaView;
  rpc: Rpc;
  threadId: string | null;
  mode: ChatMode;
  onMode(mode: ChatMode): void;
  onStarted(threadId: string): void;
  /** The comments card is open on the right; phones show it as a sheet instead. */
  besideComments: boolean;
}) {
  const navigate = useBbNavigate();
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState(0);
  const showThread = threadId && (mode === "thread" || mode === "minimized");

  const compose = () => {
    setFocus((value) => value + 1);
    onMode("compose");
  };

  return (
    <div
      className={cn(
        "pages-chat pointer-events-none absolute right-6 bottom-4 z-30 flex w-[min(460px,calc(100%-2.5rem))] flex-col gap-2 max-md:inset-x-2 max-md:bottom-2 max-md:w-auto",
        besideComments && "md:right-[344px] md:w-[min(460px,calc(100%-360px))] max-md:hidden",
      )}
    >
      {showThread ? (
        <section aria-label="Page chat" className={cn(CARD, mode === "thread" && "h-[min(620px,calc(100vh-7rem))] max-md:h-[80vh]")}>
          <header className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-2">
            <button
              type="button"
              aria-label={mode === "thread" ? "Minimize chat" : "Expand chat"}
              className={HEADER_BUTTON}
              onClick={() => onMode(mode === "thread" ? "minimized" : "thread")}
            >
              <Icon name={mode === "thread" ? "Minus" : "ChevronUp"} className="size-4" />
            </button>
            <button
              type="button"
              className="pages-thread-title min-w-0 flex-1 truncate text-left text-sm font-medium"
              onClick={() => mode === "minimized" && onMode("thread")}
            >
              <ThreadTitle threadId={threadId} />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label="Chat actions" className={HEADER_BUTTON}>
                  <Icon name="MoreHorizontal" className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onSelect={() => navigate.toThread(threadId)}>
                  <Icon name="ExternalLink" className="size-4" /> Open thread
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={compose}>
                  <Icon name="Plus" className="size-4" /> New chat
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <button type="button" aria-label="Close chat" className={HEADER_BUTTON} onClick={() => onMode("closed")}>
              <Icon name="X" className="size-4" />
            </button>
          </header>
          {mode === "thread" ? <ThreadChat key={threadId} threadId={threadId} variant="compact" className="min-h-0 flex-1" /> : null}
        </section>
      ) : null}

      {mode === "compose" ? (
        <section aria-label="Work with this page" className={CARD}>
          <header className="flex items-center gap-2 border-b border-border py-1.5 pr-2 pl-4 text-xs text-muted-foreground">
            <span className="min-w-0 flex-1 truncate">
              An agent works on this page with you. @mention a bot to hand it off.
            </span>
            <button type="button" aria-label="Close composer" className={HEADER_BUTTON} onClick={() => onMode(threadId ? "minimized" : "closed")}>
              <Icon name="X" className="size-4" />
            </button>
          </header>
          {error ? <p className="px-4 pt-1 text-xs text-red-500">{error}</p> : null}
          <NewThreadComposer
            className="pages-composer max-h-[60vh] min-h-0"
            layout="document"
            placeholder="Work with this page…"
            draftKey={`pages:${page.id}`}
            focusRequest={focus}
            {...(page.projectId ? { defaultProjectId: page.projectId } : {})}
            onSubmit={async (request) => {
              setError(null);
              try {
                const result = await rpc.call("work", { id: page.id, request });
                onStarted(result.threadId);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : String(cause));
                throw cause; // Keeps the draft for another try.
              }
            }}
          />
        </section>
      ) : mode !== "thread" ? (
        <button
          type="button"
          className="pointer-events-auto flex h-11 w-full items-center gap-2.5 rounded-lg border border-border bg-background px-4 text-left text-sm text-muted-foreground shadow-xl hover:text-foreground"
          onClick={compose}
        >
          <Icon name="MessageSquarePlus" className="size-4 shrink-0" />
          <span className="flex-1 truncate">Work with this page…</span>
        </button>
      ) : null}
    </div>
  );
}
