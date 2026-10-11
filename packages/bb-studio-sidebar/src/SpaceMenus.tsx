// A Space heading's controls: + (a thread or any Studio item, made in the
// Space), Browse (its Studio items and archived threads), and ⋯.
import { errorMessage } from "@bb-studio/kit/format";
import { createStudioItem, openAppPath, openWorkspaceItem } from "@bb-studio/kit/app";
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icon,
} from "@bb-studio/kit/ui";
import { experimental_useSidebarThreads, useSdk } from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { compactAge, createSpaceResolver, type StudioSpace, type Thread } from "./model.js";
import { callStudio, NEW_SPACE_EVENT, openSpaceDialog, type SpaceItem } from "./studio.js";

export const CONTROL_BUTTON = "inline-flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring";

export { NEW_SPACE_EVENT };

const kindSchema = z.object({
  id: z.string(),
  label: z.string(),
  icon: z.string().catch("File"),
  create: z.union([z.object({ mode: z.literal("rpc") }), z.object({ mode: z.literal("event"), event: z.string() }), z.null()]).catch(null),
  capabilities: z.object({ create: z.boolean().optional() }).passthrough().optional().catch(undefined),
}).passthrough();
const overviewSchema = z.object({
  providers: z.array(z.object({ pluginId: z.string(), name: z.string(), state: z.string(), kinds: z.array(kindSchema).catch([]) }).passthrough()),
}).passthrough();
type Kind = z.infer<typeof kindSchema> & { pluginId: string; providerName: string };

/** Opens a Studio item: a tab in Studio's workspace, else its own page. */
function useOpenItem(): (href: string) => void {
  const sdk = useSdk();
  return (href) => {
    if (openWorkspaceItem({ href })) return;
    openAppPath(href);
    void callStudio(sdk, "visitTab", { path: href }, z.unknown()).catch(() => {});
  };
}

function Trigger({ label, title, icon }: { label: string; title: string; icon: string }) {
  return (
    <DropdownMenuTrigger asChild>
      <button type="button" aria-label={label} title={title} className={CONTROL_BUTTON} onClick={(event) => event.stopPropagation()}>
        <Icon name={icon} className="size-3.5" aria-hidden />
      </button>
    </DropdownMenuTrigger>
  );
}

/** +: a new thread, then each kind of Studio item, made in the Space. */
export function SpaceNewMenu({ space, onNewThread }: { space: StudioSpace; onNewThread(): void }) {
  const sdk = useSdk();
  const openItem = useOpenItem();
  const [kinds, setKinds] = useState<Kind[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    setError(null);
    callStudio(sdk, "overview", null, overviewSchema).then(
      ({ providers }) => setKinds(providers.filter((provider) => provider.state === "ready").flatMap((provider) =>
        provider.kinds.filter((kind) => kind.create && (kind.capabilities?.create ?? true)).map((kind) => ({ ...kind, pluginId: provider.pluginId, providerName: provider.name })))),
      (cause: unknown) => setError(errorMessage(cause)),
    );
  };
  const create = async (kind: Kind) => {
    // An item the add-on makes in the browser needs the Space's project up front.
    let projectId = space.defaultProjectId;
    if (kind.create?.mode === "event" && !projectId) {
      try {
        ({ projectId } = await callStudio(sdk, "spaceProject", { id: space.id }, z.object({ projectId: z.string() })));
      } catch (cause) {
        toast.error(`Couldn't create a ${kind.label.toLowerCase()}: ${errorMessage(cause)}`);
        return;
      }
    }
    await createStudioItem(kind, {
      projectId,
      addOn: kind.providerName,
      create: async () => (await callStudio(sdk, "createInSpace", { id: space.id, pluginId: kind.pluginId, kind: kind.id }, z.object({ href: z.string() }))).href,
      open: openItem,
    });
  };
  const name = space.isDefault ? "Home" : space.name;
  return (
    <DropdownMenu onOpenChange={(open) => { if (open) load(); }}>
      <Trigger label={`New in ${name}`} title="New thread or item" icon="Plus" />
      <DropdownMenuContent align="end" className="w-48" aria-label={`New in ${name}`}>
        <DropdownMenuItem onSelect={onNewThread}><Icon name="MessageSquarePlus" className="size-4" />Thread</DropdownMenuItem>
        <DropdownMenuSeparator />
        {(kinds ?? []).map((kind) => (
          <DropdownMenuItem key={`${kind.pluginId}:${kind.id}`} onSelect={() => void create(kind)}>
            <Icon name={kind.icon} className="size-4" />{kind.label}
          </DropdownMenuItem>
        ))}
        {error ? <DropdownMenuItem onSelect={(event) => { event.preventDefault(); load(); }} title={error}><Icon name="RotateCcw" className="size-4" />Retry</DropdownMenuItem>
          : kinds === null ? <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
            : !kinds.length ? <DropdownMenuItem disabled>Nothing to create</DropdownMenuItem> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const ARCHIVED_PAGE = 10;

/** Items and archived threads whose titles hold every word of `query`. */
export function matchesQuery(title: string, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const lower = title.toLowerCase();
  return words.every((word) => lower.includes(word));
}

/** The Space's archived threads, loaded only while Browse is open. */
function ArchivedThreads({ space, spaces, spaceOf, activeThreads, query }: {
  space: StudioSpace;
  spaces: readonly StudioSpace[];
  spaceOf: Readonly<Record<string, string>>;
  activeThreads: readonly Thread[];
  query: string;
}) {
  const state = experimental_useSidebarThreads({ experimental_lifecycles: ["archived"] });
  const [limit, setLimit] = useState(ARCHIVED_PAGE);
  const matches = useMemo(() => {
    const archived = state.threads.filter((thread) => thread.archivedAt !== null);
    // An archived child of an active parent goes with the parent's Space.
    const resolve = createSpaceResolver([...activeThreads, ...archived], spaceOf, spaces);
    return archived
      .filter((thread) => resolve(thread) === space.id && matchesQuery(thread.displayTitle, query))
      .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
  }, [activeThreads, query, space.id, spaceOf, spaces, state.threads]);
  const more = state.experimental_archived;
  return (
    <>
      {matches.slice(0, limit).map((thread) => (
        <DropdownMenuItem key={thread.id} textValue={thread.displayTitle} onSelect={() => openAppPath(thread.href)}>
          <span className="min-w-0 flex-1 truncate">{thread.displayTitle}</span>
          {thread.archivedAt ? <span className="shrink-0 text-xs tabular-nums text-subtle-foreground">{compactAge(thread.archivedAt)}</span> : null}
        </DropdownMenuItem>
      ))}
      {matches.length > limit || more?.hasNextPage ? (
        <DropdownMenuItem
          disabled={more?.isFetchingNextPage}
          onSelect={(event) => {
            event.preventDefault();
            setLimit((current) => current + ARCHIVED_PAGE);
            if (matches.length <= limit) void more?.fetchNextPage();
          }}
        >
          {more?.isFetchingNextPage ? "Loading…" : "Load more"}
        </DropdownMenuItem>
      ) : null}
      {state.status === "error" ? <DropdownMenuItem disabled>Couldn't load archived threads</DropdownMenuItem>
        : state.status === "loading" ? <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
          : !matches.length && !more?.hasNextPage ? <DropdownMenuItem disabled>{query.trim() ? "No matching threads" : "No archived threads"}</DropdownMenuItem>
            : null}
    </>
  );
}

/** Browse: one search over the Space's Studio items and its archived threads. */
export function SpaceBrowseMenu({ space, spaces, spaceOf, activeThreads, items }: {
  space: StudioSpace;
  spaces: readonly StudioSpace[];
  spaceOf: Readonly<Record<string, string>>;
  activeThreads: readonly Thread[];
  items: readonly SpaceItem[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const openItem = useOpenItem();
  const shown = items.filter((item) => matchesQuery(item.title, query));
  const name = space.isDefault ? "Home" : space.name;
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => search.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);
  return (
    <DropdownMenu open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery(""); }}>
      <Trigger label={`Browse ${name}`} title="Studio items and archived threads" icon="Layers" />
      <DropdownMenuContent align="end" className="max-h-96 w-72 overflow-auto" aria-label={`Browse ${name}`}>
        <div className="sticky -top-1 z-10 -mx-1 -mt-1 bg-popover p-1">
          <input
            ref={search}
            type="search"
            value={query}
            placeholder="Search items and archived threads"
            aria-label={`Search ${name}`}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              // Keep typing out of the menu's typeahead; arrow down moves into the list.
              if (event.key === "ArrowDown") {
                event.preventDefault();
                event.currentTarget.closest("[role=menu]")?.querySelector<HTMLElement>("[role=menuitem]:not([data-disabled])")?.focus();
              } else if (event.key !== "Escape" && event.key !== "Tab") event.stopPropagation();
            }}
            className="h-7 w-full rounded-sm border border-input bg-transparent px-2 text-sm outline-none placeholder:text-subtle-foreground focus:border-ring"
          />
        </div>
        {shown.length ? (
          <>
            <DropdownMenuLabel className="text-xs font-medium text-subtle-foreground">Studio items</DropdownMenuLabel>
            {shown.map((item) => (
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
        {open ? <ArchivedThreads space={space} spaces={spaces} spaceOf={spaceOf} activeThreads={activeThreads} query={query} /> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** ⋯: New thread here, the Space's dialogs, and its hidden threads. */
export function SpaceActionsMenu({ space, onNewThread, hiddenCount, revealed, onToggleRevealed }: {
  space: StudioSpace;
  onNewThread(): void;
  hiddenCount: number;
  revealed: boolean;
  onToggleRevealed(): void;
}) {
  const name = space.isDefault ? "Home" : space.name;
  const item = (icon: string, label: ReactNode, onSelect: () => void, className?: string) => (
    <DropdownMenuItem className={className} onSelect={onSelect}><Icon name={icon} />{label}</DropdownMenuItem>
  );
  return (
    <DropdownMenu>
      <Trigger label={`${name} actions`} title="Space actions" icon="MoreHorizontal" />
      <DropdownMenuContent align="end" className="min-w-48">
        {item("MessageSquarePlus", "New thread here", onNewThread)}
        <DropdownMenuSeparator />
        {item("MessageSquare", "Threads…", () => openSpaceDialog(space.id, "threads"))}
        {item("Folder", "Projects…", () => openSpaceDialog(space.id, "projects"))}
        {hiddenCount > 0 ? item(revealed ? "EyeOff" : "Eye", revealed ? "Hide hidden threads" : `Show ${hiddenCount} hidden thread${hiddenCount === 1 ? "" : "s"}`, onToggleRevealed) : null}
        <DropdownMenuSeparator />
        {item("Star", "Lead and heartbeat…", () => openSpaceDialog(space.id, "heartbeat"))}
        {item("Edit", "Edit Space", () => openSpaceDialog(space.id, "edit"))}
        {space.isDefault ? null : item("Trash2", "Delete Space", () => openSpaceDialog(space.id, "delete"), cn("text-destructive focus:text-destructive"))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
