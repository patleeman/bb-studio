import { useEffect, useMemo, useRef, useState } from "react";
import { openAppPath } from "@bb-studio/kit/app";
import { experimental_useSidebarThreads, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SIDEBAR_CONTROL_BUTTON_CLASS } from "../rows/sidebarRowClasses.js";
import { compactAge } from "./SpaceThreadRow.js";
import { createSpaceResolver, defaultSpaceId, projectSpaces, type StudioSpace } from "./space-groups.js";

/**
 * The Space's archived threads, newest archived first. An archived child of
 * an active parent goes with that parent's Space, so the resolver also sees
 * the sidebar's active threads.
 */
export function spaceArchivedThreads(
  threads: readonly PluginSidebarThread[],
  space: StudioSpace,
  spaces: readonly StudioSpace[],
  spaceOf: Readonly<Record<string, string>>,
  activeThreads: readonly PluginSidebarThread[] = [],
): PluginSidebarThread[] {
  const archived = threads.filter((thread) => thread.archivedAt !== null);
  const resolve = createSpaceResolver([...activeThreads, ...archived], spaceOf, new Set(spaces.map((each) => each.id)), defaultSpaceId(spaces), projectSpaces(spaces));
  return archived
    .filter((thread) => resolve(thread) === space.id)
    .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
}

/** How many archived threads the menu lists before asking for a search. */
export const ARCHIVED_MENU_LIMIT = 10;

/** The archived threads to list for a search: the newest matches, up to the limit. */
export function searchArchivedThreads(
  threads: readonly PluginSidebarThread[],
  query: string,
  limit = ARCHIVED_MENU_LIMIT,
): { shown: PluginSidebarThread[]; hidden: number } {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = terms.length
    ? threads.filter((thread) => {
      const title = thread.displayTitle.toLowerCase();
      return terms.every((term) => title.includes(term));
    })
    : threads;
  return { shown: matches.slice(0, limit), hidden: Math.max(0, matches.length - limit) };
}

/** Loads archived threads only while the menu is open. */
function ArchivedItems({ space, spaces, spaceOf, activeThreads, query }: {
  space: StudioSpace;
  spaces: readonly StudioSpace[];
  spaceOf: Readonly<Record<string, string>>;
  activeThreads: readonly PluginSidebarThread[];
  query: string;
}) {
  const state = experimental_useSidebarThreads({ experimental_lifecycles: ["archived"] });
  const archived = useMemo(
    () => spaceArchivedThreads(state.threads, space, spaces, spaceOf, activeThreads),
    [activeThreads, space, spaceOf, spaces, state.threads],
  );
  const { shown, hidden } = useMemo(() => searchArchivedThreads(archived, query), [archived, query]);
  const more = state.experimental_archived;
  const searching = query.trim() !== "";
  const loading = state.status === "loading" || more?.status === "loading";
  return (
    <>
      {shown.map((thread) => (
        <DropdownMenuItem key={thread.id} textValue={thread.displayTitle} onSelect={() => openAppPath(thread.href, { main: true })}>
          <span className="min-w-0 flex-1 truncate">{thread.displayTitle}</span>
          {thread.archivedAt ? <span className="shrink-0 text-xs tabular-nums text-subtle-foreground">{compactAge(thread.archivedAt)}</span> : null}
        </DropdownMenuItem>
      ))}
      {hidden > 0 ? (
        <DropdownMenuItem disabled className="text-xs">
          {searching ? `${hidden} more match${hidden === 1 ? "" : "es"}, refine the search` : "Search to find older threads"}
        </DropdownMenuItem>
      ) : searching && more?.hasNextPage ? (
        <DropdownMenuItem disabled={more.isFetchingNextPage} onSelect={(event) => { event.preventDefault(); void more.fetchNextPage(); }}>
          {more.isFetchingNextPage ? "Searching…" : "Search older threads"}
        </DropdownMenuItem>
      ) : null}
      {state.status === "error" || more?.status === "error" ? <DropdownMenuItem disabled>Couldn't load archived threads</DropdownMenuItem>
        : loading ? <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
          : !shown.length && !(searching && more?.hasNextPage)
            ? <DropdownMenuItem disabled>{searching ? "No matching threads" : "No archived threads"}</DropdownMenuItem>
            : null}
    </>
  );
}

/** Beside a Space's Threads +: its archived threads, to open one. */
export function SpaceArchivedMenu({ space, spaces, spaceOf, activeThreads }: {
  space: StudioSpace;
  spaces: readonly StudioSpace[];
  spaceOf: Readonly<Record<string, string>>;
  /** The sidebar's threads, so archived children follow their parent's Space. */
  activeThreads: readonly PluginSidebarThread[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  // The menu focuses itself on open; the search takes focus after it.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);
  return (
    <DropdownMenu open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery(""); }}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Archived threads in ${space.name}`}
          title="Archived threads"
          className={cn(SIDEBAR_CONTROL_BUTTON_CLASS, "inline-flex items-center justify-center")}
          onClick={(event) => event.stopPropagation()}
        >
          <Icon name="Archive" className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-80 w-64 overflow-auto"
        aria-label={`Archived threads in ${space.name}`}
      >
        <div className="sticky -top-1 z-10 -mx-1 -mt-1 bg-popover px-1 pt-1 pb-1">
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder="Search archived threads"
            aria-label={`Search archived threads in ${space.name}`}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              // Keep typing out of the menu's typeahead; arrow down moves into the list.
              if (event.key === "ArrowDown") {
                event.preventDefault();
                event.currentTarget.closest("[role=menu]")?.querySelector<HTMLElement>("[role=menuitem]:not([data-disabled])")?.focus();
              } else if (event.key !== "Escape" && event.key !== "Tab") {
                event.stopPropagation();
              }
            }}
            className="h-7 w-full rounded-sm border border-input bg-transparent px-2 text-sm outline-none placeholder:text-subtle-foreground focus:border-ring"
          />
        </div>
        {open ? <ArchivedItems space={space} spaces={spaces} spaceOf={spaceOf} activeThreads={activeThreads} query={query} /> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
