// The chat's menu: switch to any thread, start a new chat, or open this one
// in BB's own view.
import { experimental_useSidebarThreadActions, experimental_useSidebarThreads } from "@get-bb/plugin-sdk/app";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icon,
} from "@bb-studio/kit/app";
import { useMemo, useState } from "react";
import { floatThread, setChat } from "./store";
import { HEADER_BUTTON } from "./styles";

const SHOWN = 8;

export function ThreadMenu({ threadId, onNewChat }: { threadId: string; onNewChat(): void }) {
  const { threads } = experimental_useSidebarThreads();
  const actions = experimental_useSidebarThreadActions();
  const [filter, setFilter] = useState("");
  const matches = useMemo(() => {
    const words = filter.trim().toLowerCase();
    return threads
      .filter((thread) => thread.id !== threadId && !thread.parentThreadId)
      .filter((thread) => !words || thread.displayTitle.toLowerCase().includes(words))
      .slice(0, SHOWN);
  }, [threads, threadId, filter]);

  const open = (split: boolean) => {
    // BB's view takes over; the card would only repeat it.
    setChat({ mode: "closed" });
    actions.open(threadId, { split });
  };

  return (
    <DropdownMenu onOpenChange={(opened) => !opened && setFilter("")}>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Chat actions" className={HEADER_BUTTON}>
          <Icon name="MoreHorizontal" className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="pb-1">Switch to</DropdownMenuLabel>
        <input
          aria-label="Find a thread"
          placeholder="Find a thread…"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          // Typing belongs to the field, not the menu's type-ahead.
          onKeyDown={(event) => event.key !== "Escape" && event.stopPropagation()}
          className="mx-1 mb-1 h-7 w-[calc(100%-0.5rem)] rounded-md border border-border bg-transparent px-2 text-sm outline-none focus:border-ring"
        />
        {matches.map((thread) => (
          <DropdownMenuItem key={thread.id} onSelect={() => floatThread(thread.id)}>
            <Icon name="MessageSquare" className="size-4" />
            <span className="min-w-0 flex-1 truncate">{thread.displayTitle}</span>
          </DropdownMenuItem>
        ))}
        {!matches.length ? <p className="px-2 py-1.5 text-xs text-muted-foreground">No other threads match.</p> : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onNewChat}>
          <Icon name="Plus" className="size-4" /> New chat
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => open(false)}>
          <Icon name="ExternalLink" className="size-4" /> Open thread
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => open(true)}>
          <Icon name="Columns2" className="size-4" /> Open in split
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
