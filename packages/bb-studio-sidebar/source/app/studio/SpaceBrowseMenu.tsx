import { useEffect, useMemo, useRef, useState } from "react";
import { openAppPath } from "@bb-studio/kit/app";
import { experimental_useSidebarThreads, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SIDEBAR_CONTROL_BUTTON_CLASS } from "../rows/sidebarRowClasses.js";
import { compactAge } from "./SpaceThreadRow.js";
import { createSpaceResolver, defaultSpaceId, projectSpaces, type StudioSpace } from "./space-groups.js";
import { browsableItems, useOpenInSpace } from "./SpaceStudioList.js";
import type { SpaceBrowseItem, SpaceItems } from "./studioSpaces.js";

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

/** How many archived threads the menu lists at first, and how many more each Load more adds. */
export const ARCHIVED_MENU_LIMIT = 10;

const terms = (query: string) => query.trim().toLowerCase().split(/\s+/).filter(Boolean);

/** The Space's Studio items whose titles match every search term. */
export function searchStudioItems(items: readonly SpaceBrowseItem[], query: string): SpaceBrowseItem[] {
  const words = terms(query);
  return words.length ? items.filter((item) => words.every((word) => item.title.toLowerCase().includes(word))) : [...items];
}

/** The archived threads to list for a search: the newest matches, up to the limit. */
export function searchArchivedThreads(
  threads: readonly PluginSidebarThread[],
  query: string,
  limit = ARCHIVED_MENU_LIMIT,
): { shown: PluginSidebarThread[]; hidden: number } {
  const words = terms(query);
  const matches = words.length
    ? threads.filter((thread) => {
      const title = thread.displayTitle.toLowerCase();
      return words.every((word) => title.includes(word));
    })
    : threads;
  return { shown: matches.slice(0, limit), hidden: Math.max(0, matches.length - limit) };
}

/** Loads archived threads only while the menu is open. */
function ArchivedItems({ space, spaces, spaceOf, activeThreads, query, limit, onLoadMore }: {
  space: StudioSpace;
  spaces: readonly StudioSpace[];
  spaceOf: Readonly<Record<string, string>>;
  activeThreads: readonly PluginSidebarThread[];
  query: string;
  limit: number;
  onLoadMore: () => void;
}) {
  const state = experimental_useSidebarThreads({ experimental_lifecycles: ["archived"] });
  const archived = useMemo(
    () => spaceArchivedThreads(state.threads, space, spaces, spaceOf, activeThreads),
    [activeThreads, space, spaceOf, spaces, state.threads],
  );
  const { shown, hidden } = useMemo(() => searchArchivedThreads(archived, query, limit), [archived, limit, query]);
  const more = state.experimental_archived;
  const searching = query.trim() !== "";
  const loading = state.status === "loading" || more?.status === "loading";
  return (
    <>
      {shown.map((thread) => (
        <DropdownMenuItem key={thread.id} textValue={thread.displayTitle} onSelect={() => openAppPath(thread.href)}>
          <span className="min-w-0 flex-1 truncate">{thread.displayTitle}</span>
          {thread.archivedAt ? <span className="shrink-0 text-xs tabular-nums text-subtle-foreground">{compactAge(thread.archivedAt)}</span> : null}
        </DropdownMenuItem>
      ))}
      {hidden > 0 || more?.hasNextPage ? (
        <DropdownMenuItem
          disabled={more?.isFetchingNextPage}
          onSelect={(event) => {
            event.preventDefault();
            onLoadMore();
            // Everything loaded is on show: fetch the next page of archived threads.
            if (hidden === 0) void more?.fetchNextPage();
          }}
        >
          {more?.isFetchingNextPage ? "Loading…" : "Load more"}
        </DropdownMenuItem>
      ) : null}
      {state.status === "error" || more?.status === "error" ? <DropdownMenuItem disabled>Couldn't load archived threads</DropdownMenuItem>
        : loading ? <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
          : !shown.length && !more?.hasNextPage
            ? <DropdownMenuItem disabled>{searching ? "No matching threads" : "No archived threads"}</DropdownMenuItem>
            : null}
    </>
  );
}

/**
 * A Space heading's Browse: one search over the Space's Studio items that
 * aren't open and its archived threads, to open one of either.
 */
export function SpaceBrowseMenu({ space, spaces, spaceOf, activeThreads, items }: {
  space: StudioSpace;
  spaces: readonly StudioSpace[];
  spaceOf: Readonly<Record<string, string>>;
  /** The sidebar's threads, so archived children follow their parent's Space. */
  activeThreads: readonly PluginSidebarThread[];
  items: SpaceItems | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(ARCHIVED_MENU_LIMIT);
  const searchRef = useRef<HTMLInputElement>(null);
  const openItem = useOpenInSpace();
  const studioItems = useMemo(() => searchStudioItems(browsableItems(items), query), [items, query]);
  // The menu focuses itself on open; the search takes focus after it.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);
  return (
    <DropdownMenu open={open} onOpenChange={(next) => { setOpen(next); if (!next) { setQuery(""); setLimit(ARCHIVED_MENU_LIMIT); } }}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Browse ${space.name}`}
          title="Studio items and archived threads"
          className={cn(SIDEBAR_CONTROL_BUTTON_CLASS, "inline-flex items-center justify-center")}
          onClick={(event) => event.stopPropagation()}
        >
          <Icon name="Layers" className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-96 w-72 overflow-auto"
        aria-label={`Browse ${space.name}`}
      >
        <div className="sticky -top-1 z-10 -mx-1 -mt-1 bg-popover px-1 pt-1 pb-1">
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder="Search items and archived threads"
            aria-label={`Search ${space.name}`}
            onChange={(event) => { setQuery(event.currentTarget.value); setLimit(ARCHIVED_MENU_LIMIT); }}
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
        {studioItems.length ? (
          <>
            <DropdownMenuLabel className="text-xs font-medium text-subtle-foreground">Studio items</DropdownMenuLabel>
            {studioItems.map((item) => (
              <DropdownMenuItem key={`${item.pluginId}:${item.id}`} textValue={item.title} onSelect={() => openItem(item.href)}>
                {item.icon ? <span className="w-4 text-center text-[13px] leading-none">{item.icon}</span> : <Icon name={item.kindIcon} className="size-4" />}
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                {item.updatedAt ? <span className="shrink-0 text-xs tabular-nums text-subtle-foreground">{compactAge(item.updatedAt)}</span> : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuLabel className="text-xs font-medium text-subtle-foreground">Archived threads</DropdownMenuLabel>
        {open ? <ArchivedItems space={space} spaces={spaces} spaceOf={spaceOf} activeThreads={activeThreads} query={query} limit={limit} onLoadMore={() => setLimit((current) => current + ARCHIVED_MENU_LIMIT)} /> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
