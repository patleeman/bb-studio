import { errorMessage } from "@bb-studio/kit/format";
import { useCallback, useEffect, useRef, useState } from "react";
import { createStudioItem, openAppPath, openPathInSplit, usePathname } from "@bb-studio/kit/app";
import { toast } from "sonner";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SIDEBAR_CONTROL_BUTTON_CLASS, SIDEBAR_ROW_SELECTED_STATE_CLASS } from "../rows/sidebarRowClasses.js";
import type { SpaceBrowseItem, SpaceItems } from "./studioSpaces.js";

let splitting = false;

/**
 * Opens a Studio item in the main area, in place of the current pane, or in
 * a split beside it with `split` (⌘/Ctrl-click) when BB will split.
 * `anchor` is a link this plugin renders; BB splits a Mod-click on one.
 */
export function openStudioItem(anchor: HTMLAnchorElement | null, href: string, split = false): void {
  if (split) {
    splitting = true;
    try {
      if (openPathInSplit(anchor, href)) return;
    } catch {
      // No split here; open in place.
    } finally {
      splitting = false;
    }
  }
  openAppPath(href);
}

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
const createdSchema = z.object({ href: z.string(), title: z.string().optional() });
const projectSchema = z.object({ projectId: z.string() });

type Kind = z.infer<typeof kindSchema> & { pluginId: string; providerName: string };

/** A new thread, then every kind of Studio item, made in the Space's folder, from +. */
function NewItemMenu({ spaceId, spaceName, defaultProjectId, onCreated, onNewThread }: {
  spaceId: string;
  spaceName: string;
  defaultProjectId: string | null;
  onCreated(href: string): void;
  onNewThread(): void;
}) {
  const sdk = useSdk();
  const [kinds, setKinds] = useState<Kind[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Parsed here, so a malformed answer lands in the error path instead of throwing in a then.
  const call = useCallback(async <T,>(method: string, input: unknown, outputSchema: z.ZodType<T>): Promise<T> =>
    outputSchema.parse(await sdk.plugins.callRpc({ pluginId: "studio", method, input: input as never, outputSchema, signal: AbortSignal.timeout(15_000) })), [sdk]);
  const load = () => {
    setError(null);
    call("overview", null, overviewSchema).then(
      ({ providers }) => setKinds(providers.filter((provider) => provider.state === "ready").flatMap((provider) =>
        provider.kinds.filter((kind) => kind.create && (kind.capabilities?.create ?? true)).map((kind) => ({ ...kind, pluginId: provider.pluginId, providerName: provider.name })))),
      (cause: unknown) => setError(errorMessage(cause)),
    );
  };
  const create = async (kind: Kind) => {
    // An item the add-on makes in the browser needs the Space's project up front.
    let projectId = defaultProjectId;
    if (kind.create?.mode === "event" && !projectId) {
      try {
        ({ projectId } = await call("spaceProject", { id: spaceId }, projectSchema));
      } catch (cause) {
        toast.error(`Couldn't create a ${kind.label.toLowerCase()}: ${errorMessage(cause)}`);
        return;
      }
    }
    await createStudioItem(kind, {
      projectId,
      addOn: kind.providerName,
      create: async () => (await call("createInSpace", { id: spaceId, pluginId: kind.pluginId, kind: kind.id }, createdSchema)).href,
      open: onCreated,
    });
  };
  return (
    <DropdownMenu onOpenChange={(open) => { if (open) load(); }}>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`New in ${spaceName}`} title="New thread or item" className={cn(SIDEBAR_CONTROL_BUTTON_CLASS, "inline-flex items-center justify-center")} onClick={(event) => event.stopPropagation()}>
          <Icon name="Plus" className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48" aria-label={`New in ${spaceName}`}>
        <DropdownMenuItem onSelect={onNewThread}>
          <Icon name="MessageSquarePlus" className="size-4" />Thread
        </DropdownMenuItem>
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

type OpenItem = SpaceItems["open"][number];

const resultsSchema = z.object({ done: z.array(z.string()) }).passthrough();

function copyText(text: string, done: string) {
  navigator.clipboard.writeText(text).then(() => toast.success(done), () => toast.error("Couldn't copy."));
}

/**
 * An open Studio item as a chip: click opens it in the main pane, ⌘/Ctrl-click
 * in a split beside it, as a thread row does; × or a middle-click closes it
 * here; right-click (a long press on touch) has the rest, as a thread's menu does.
 */
/** Whether the main view shows `href`, or a view under it such as a page's composer. */
export function showsItem(pathname: string, href: string): boolean {
  const path = href.split(/[?#]/)[0]!.replace(/\/+$/, "");
  return pathname === path || pathname.startsWith(`${path}/`);
}

function StudioItemChip({ item, onClose }: { item: OpenItem; onClose(): void }) {
  const sdk = useSdk();
  // On screen: highlighted like the selected thread's row.
  const active = showsItem(usePathname(), item.href);
  const link = useRef<HTMLAnchorElement>(null);
  const [renaming, setRenaming] = useState(false);
  const call = (method: "archive" | "remove" | "rename", input: Record<string, unknown>) =>
    sdk.plugins.callRpc({ pluginId: "studio", method, input: input as never, outputSchema: resultsSchema, signal: AbortSignal.timeout(15_000) });
  const rename = (title: string) => {
    setRenaming(false);
    const next = title.trim();
    if (!next || next === item.title) return;
    void call("rename", { pluginId: item.pluginId, id: item.id, title: next }).catch(
      (cause: unknown) => toast.error(`Couldn't rename: ${errorMessage(cause)}`),
    );
  };
  const pin = () => void sdk.plugins.callRpc({ pluginId: "studio", method: "pinTab", input: { pluginId: item.pluginId, id: item.id, pinned: !item.pinned } as never, outputSchema: z.object({ ok: z.boolean() }), signal: AbortSignal.timeout(15_000) }).catch(
    (cause: unknown) => toast.error(`Couldn't ${item.pinned ? "unpin" : "pin"}: ${errorMessage(cause)}`),
  );
  const archive = () => void call("archive", { pluginId: item.pluginId, ids: [item.id], archived: true }).then(
    () => toast.success(`Archived ${item.title}`),
    (cause: unknown) => toast.error(`Couldn't archive: ${errorMessage(cause)}`),
  );
  const remove = () => {
    if (!window.confirm(`Delete “${item.title}”? This can't be undone.`)) return;
    void call("remove", { pluginId: item.pluginId, ids: [item.id] }).then(
      () => toast.success(`Deleted ${item.title}`),
      (cause: unknown) => toast.error(`Couldn't delete: ${errorMessage(cause)}`),
    );
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <span
          className={cn(
            "group/item relative inline-flex h-6 max-w-full min-w-0 items-center rounded-full border text-xs text-sidebar-foreground transition-colors max-md:pointer-coarse:h-8",
            active
              ? cn(SIDEBAR_ROW_SELECTED_STATE_CLASS, "border-transparent font-medium")
              : "border-border bg-sidebar-accent/40 hover:bg-sidebar-accent focus-within:bg-sidebar-accent data-[state=open]:bg-sidebar-accent",
          )}
          data-space-studio-item={`${item.pluginId}:${item.id}`}
          data-active={active ? "" : undefined}
        >
          {renaming ? (
            <input
              autoFocus
              defaultValue={item.title}
              aria-label={`Rename ${item.title}`}
              maxLength={200}
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); rename(event.currentTarget.value); }
                if (event.key === "Escape") { event.preventDefault(); setRenaming(false); }
              }}
              onBlur={(event) => rename(event.currentTarget.value)}
              className="h-full w-40 rounded-full border border-sidebar-ring bg-sidebar px-2 text-xs outline-none"
            />
          ) : (
            <a
              ref={link}
              href={item.href}
              aria-current={active ? "page" : undefined}
              title={item.preview ? `${item.title}\n${item.preview}` : item.title}
              onClick={(event) => {
                // The split's own Mod-click goes on to BB.
                if (splitting || event.button !== 0 || event.altKey) return;
                event.preventDefault();
                openStudioItem(link.current, item.href, event.metaKey || event.ctrlKey);
              }}
              onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); onClose(); } }}
              className="flex h-full min-w-0 items-center gap-1.5 rounded-full pr-2 pl-2 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-hover/item:pr-0.5 group-focus-within/item:pr-0.5 max-md:pointer-coarse:pr-0.5"
            >
              {item.icon ? <span className="text-[12px] leading-none">{item.icon}</span> : <Icon name={item.kindIcon} className="size-3.5 shrink-0" />}
              <span className="max-w-40 truncate">{item.title}</span>
              {item.pinned ? <Icon name="Pin" aria-label="Pinned" className="size-3 shrink-0 text-subtle-foreground" /> : null}
            </a>
          )}
          {renaming ? null : (
            <button
              type="button"
              aria-label={`Close ${item.title}`}
              title="Close"
              onClick={onClose}
              className="mr-0.5 hidden size-5 shrink-0 items-center justify-center rounded-full text-subtle-foreground hover:bg-state-hover hover:text-muted-foreground group-hover/item:inline-flex group-focus-within/item:inline-flex max-md:pointer-coarse:inline-flex"
            >
              <Icon name="X" className="size-3" />
            </button>
          )}
        </span>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52" aria-label={`${item.title} actions`}>
        <ContextMenuItem onSelect={() => openStudioItem(link.current, item.href, true)}><Icon name="Columns2" className="size-4" />Open in split</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => copyText(`[${item.title}](${item.href})`, "Link copied")}><Icon name="studio/link" fallback="Copy" className="size-4" />Copy link</ContextMenuItem>
        <ContextMenuItem onSelect={() => copyText(item.id, "ID copied")}><Icon name="Copy" className="size-4" />Copy ID</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={pin}><Icon name={item.pinned ? "PinOff" : "Pin"} className="size-4" />{item.pinned ? "Unpin" : "Pin"}</ContextMenuItem>
        <ContextMenuItem onSelect={() => setTimeout(() => setRenaming(true), 0)}><Icon name="Edit" className="size-4" />Rename</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onClose}><Icon name="X" className="size-4" />Close</ContextMenuItem>
        <ContextMenuItem onSelect={archive}><Icon name="Archive" className="size-4" />Archive</ContextMenuItem>
        <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={remove}><Icon name="Trash2" className="size-4" />Delete</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Opens an item picked or made from a Space's menus, and lists it as open in the Space. */
export function useOpenInSpace(): (href: string) => void {
  const sdk = useSdk();
  return (href) => {
    openStudioItem(null, href);
    void sdk.plugins.callRpc({ pluginId: "studio", method: "visitTab", input: { path: href } as never, outputSchema: z.unknown(), signal: AbortSignal.timeout(15_000) }).catch(() => {});
  };
}

/** The Space's items that aren't open, to open one from the heading's Browse menu. */
export function browsableItems(items: SpaceItems | undefined): SpaceBrowseItem[] {
  const open = new Set((items?.open ?? []).map((item) => `${item.pluginId}:${item.id}`));
  return (items?.all ?? []).filter((item) => !open.has(`${item.pluginId}:${item.id}`));
}

/** The Space heading's +: a new thread, or any kind of Studio item, made in the Space. */
export function SpaceNewMenu({ spaceId, spaceName, defaultProjectId, onNewThread }: {
  spaceId: string;
  spaceName: string;
  defaultProjectId: string | null;
  onNewThread(): void;
}) {
  const openPicked = useOpenInSpace();
  return <NewItemMenu spaceId={spaceId} spaceName={spaceName} defaultProjectId={defaultProjectId} onCreated={openPicked} onNewThread={onNewThread} />;
}

/**
 * A Space's open Studio items, like tabs: each opens in the main area, and ×
 * closes it here without touching the item. Opening any of the Space's items
 * adds it. Their kind icons set them apart from threads, so they need no heading.
 */
export function SpaceStudioList({ spaceName, items }: {
  spaceName: string;
  items: SpaceItems | undefined;
}) {
  const sdk = useSdk();
  // Closed here until Studio's next list catches up.
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const key = (item: { pluginId: string; id: string }) => `${item.pluginId}:${item.id}`;
  // Once a list leaves an item out, Studio has it closed; opening it again must show it.
  useEffect(() => {
    setClosed((current) => {
      const still = new Set((items?.open ?? []).map(key).filter((each) => current.has(each)));
      return still.size === current.size ? current : still;
    });
  }, [items]);
  const open = (items?.open ?? []).filter((item) => !closed.has(key(item)));
  const close = (item: SpaceItems["open"][number]) => {
    setClosed((current) => new Set(current).add(key(item)));
    void sdk.plugins.callRpc({ pluginId: "studio", method: "closeTabs", input: { items: [{ pluginId: item.pluginId, id: item.id }] } as never, outputSchema: z.object({ ok: z.boolean() }), signal: AbortSignal.timeout(15_000) })
      .catch(() => setClosed((current) => { const next = new Set(current); next.delete(key(item)); return next; }));
  };
  if (!open.length) return null;
  return (
    // Chips, not rows: open items read as tabs, apart from the threads below.
    <div role="group" aria-label={`${spaceName} Studio items`} className="flex flex-wrap gap-1 px-2 pt-0.5 pb-1.5">
      {open.map((item) => (
        <StudioItemChip key={key(item)} item={item} onClose={() => close(item)} />
      ))}
    </div>
  );
}
