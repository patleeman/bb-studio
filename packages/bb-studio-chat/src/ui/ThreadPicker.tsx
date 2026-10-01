// "Open thread": the item's last chat first, then recent threads, or what a
// search finds once you type. Picking one hands its id back.
import { useSdk } from "@get-bb/plugin-sdk/app";
import { cn, Icon } from "@bb-studio/kit/app";
import { relativeTime } from "@bb-studio/kit/format";
import { useEffect, useRef, useState } from "react";

export interface PickedThread {
  id: string;
  title: string;
  updatedAt: number | null;
}

const RECENT_LIMIT = 30;
const SEARCH_DELAY_MS = 200;

interface ThreadLike {
  id: string;
  title?: string | null;
  titleFallback?: string | null;
  updatedAt?: number | null;
  archivedAt?: number | null;
}

const picked = (thread: ThreadLike): PickedThread => ({
  id: thread.id,
  title: thread.title?.trim() || thread.titleFallback?.trim() || "Untitled thread",
  updatedAt: thread.updatedAt ?? null,
});

/** Recent threads with the item's last chat first, or search hits for `query`; null while loading. */
function useThreads(query: string, lastThreadId: string | null): PickedThread[] | null {
  const sdk = useSdk();
  const [found, setFound] = useState<{ query: string; threads: PickedThread[] } | null>(null);
  useEffect(() => {
    let live = true;
    const term = query.trim();
    const load = async () => {
      if (term.length < 2) {
        const threads = ((await sdk.threads.list({ archived: false, limit: RECENT_LIMIT })) as ThreadLike[]).map(picked);
        if (!lastThreadId) return threads;
        const listed = threads.find((thread) => thread.id === lastThreadId);
        const last = listed ?? (await sdk.threads.get({ threadId: lastThreadId }).then((thread) => picked(thread as ThreadLike), () => null));
        return last ? [last, ...threads.filter((thread) => thread !== listed)] : threads;
      }
      const result = await sdk.threads.search({ query: term, limitPerGroup: String(RECENT_LIMIT) });
      return result.active.results.map(({ thread }) => picked(thread));
    };
    const timer = setTimeout(
      () =>
        load().then(
          (threads) => live && setFound({ query, threads }),
          () => live && setFound({ query, threads: [] }),
        ),
      term.length < 2 ? 0 : SEARCH_DELAY_MS,
    );
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [sdk, query, lastThreadId]);
  return found?.query === query ? found.threads : null;
}

export function ThreadPicker({
  lastThreadId,
  onPick,
  onClose,
}: {
  /** The thread last used on the item, listed first. */
  lastThreadId: string | null;
  onPick: (threadId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const threads = useThreads(query, lastThreadId);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const ordered = threads ?? [];
  const active = Math.min(cursor, Math.max(ordered.length - 1, 0));

  return (
    <div
      className="flex min-h-0 flex-col"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
        else if (event.key === "ArrowDown") setCursor(Math.min(active + 1, ordered.length - 1));
        else if (event.key === "ArrowUp") setCursor(Math.max(active - 1, 0));
        else if (event.key === "Enter" && ordered[active]) onPick(ordered[active].id);
        else return;
        event.preventDefault();
      }}
    >
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Icon name="Search" className="size-4 shrink-0 text-muted-foreground" />
        <input
          ref={input}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
          }}
          placeholder="Find a thread…"
          aria-label="Find a thread"
          className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <ul role="listbox" aria-label="Threads" className="studio-chat-threads max-h-[min(360px,50vh)] overflow-y-auto p-1">
        {threads === null ? <li className="px-3 py-2 text-xs text-muted-foreground">Loading…</li> : null}
        {threads !== null && !ordered.length ? <li className="px-3 py-2 text-xs text-muted-foreground">No threads found.</li> : null}
        {ordered.map((thread, index) => (
          <li
            key={thread.id}
            role="option"
            tabIndex={-1}
            aria-selected={index === active}
            data-thread-id={thread.id}
            className={cn("flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm", index === active && "bg-state-hover")}
            onMouseEnter={() => setCursor(index)}
            onClick={() => onPick(thread.id)}
          >
            <Icon name="MessageSquare" className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{thread.title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {thread.id === lastThreadId ? "Last used here" : thread.updatedAt ? relativeTime(thread.updatedAt) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
