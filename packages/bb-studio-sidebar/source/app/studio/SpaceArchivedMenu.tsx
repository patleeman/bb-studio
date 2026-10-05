import { useMemo, useState } from "react";
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

/** Loads archived threads only while the menu is open. */
function ArchivedItems({ space, spaces, spaceOf, activeThreads }: {
  space: StudioSpace;
  spaces: readonly StudioSpace[];
  spaceOf: Readonly<Record<string, string>>;
  activeThreads: readonly PluginSidebarThread[];
}) {
  const state = experimental_useSidebarThreads({ experimental_lifecycles: ["archived"] });
  const archived = useMemo(
    () => spaceArchivedThreads(state.threads, space, spaces, spaceOf, activeThreads),
    [activeThreads, space, spaceOf, spaces, state.threads],
  );
  const more = state.experimental_archived;
  const loading = state.status === "loading" || more?.status === "loading";
  return (
    <>
      {archived.map((thread) => (
        <DropdownMenuItem key={thread.id} textValue={thread.displayTitle} onSelect={() => openAppPath(thread.href, { main: true })}>
          <span className="min-w-0 flex-1 truncate">{thread.displayTitle}</span>
          {thread.archivedAt ? <span className="shrink-0 text-xs tabular-nums text-subtle-foreground">{compactAge(thread.archivedAt)}</span> : null}
        </DropdownMenuItem>
      ))}
      {more?.hasNextPage ? (
        <DropdownMenuItem disabled={more.isFetchingNextPage} onSelect={(event) => { event.preventDefault(); void more.fetchNextPage(); }}>
          {more.isFetchingNextPage ? "Loading…" : "Load more"}
        </DropdownMenuItem>
      ) : null}
      {state.status === "error" || more?.status === "error" ? <DropdownMenuItem disabled>Couldn't load archived threads</DropdownMenuItem>
        : loading ? <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
          : !archived.length && !more?.hasNextPage ? <DropdownMenuItem disabled>No archived threads</DropdownMenuItem> : null}
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
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
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
      <DropdownMenuContent align="end" className="max-h-80 w-64 overflow-auto" aria-label={`Archived threads in ${space.name}`}>
        {open ? <ArchivedItems space={space} spaces={spaces} spaceOf={spaceOf} activeThreads={activeThreads} /> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
