import { errorMessage } from "@bb-studio/kit/format";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createStudioItem, openAppPath, openFloat, openPathInSplit, useCanFloat } from "@bb-studio/kit/app";
import { toast } from "sonner";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { EmptyState } from "@/components/ui/empty-state";
import { COARSE_POINTER_ROW_HEIGHT_CLASS } from "@/components/ui/coarse-pointer-sizing";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SIDEBAR_CONTROL_BUTTON_CLASS,
  SIDEBAR_ROW_BASE_CLASS,
  SIDEBAR_ROW_GLYPH_SLOT_CLASS,
  SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
} from "../rows/sidebarRowClasses.js";
import type { SpaceBrowseItem, SpaceItems } from "./studioSpaces.js";
import { compactAge } from "./SpaceThreadRow.js";
import { CHROME_SECTION_LABEL_CLASS } from "@/components/ui/chrome-style-tokens";
import {
  SIDEBAR_HOVER_ACTIONS_CLASS,
  SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE,
  SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
} from "../ui/sidebar-hover-actions.js";

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
  openAppPath(href, { main: true });
}

/** "Studio" or "Threads" inside a Space, with its own controls on hover. */
export function SpaceSubheading({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className={cn(SIDEBAR_HOVER_ACTIONS_ROW_CLASS, "flex h-7 items-center gap-1 pr-0.5 pl-2", CHROME_SECTION_LABEL_CLASS)}>
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {action ? (
        <span
          className={cn(SIDEBAR_HOVER_ACTIONS_CLASS, "inline-flex shrink-0 items-center has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100")}
          data-sidebar-hover-actions-mobile={SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE}
        >
          {action}
        </span>
      ) : null}
    </div>
  );
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

/** Every kind of Studio item, made in the Space's folder, from +. */
function NewItemMenu({ spaceId, spaceName, defaultProjectId, onCreated }: {
  spaceId: string;
  spaceName: string;
  defaultProjectId: string | null;
  onCreated(href: string): void;
}) {
  const sdk = useSdk();
  const [kinds, setKinds] = useState<Kind[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const call = useCallback(<T,>(method: string, input: unknown, outputSchema: z.ZodType<T>) =>
    sdk.plugins.callRpc({ pluginId: "studio", method, input: input as never, outputSchema, signal: AbortSignal.timeout(15_000) }) as Promise<T>, [sdk]);
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
        <button type="button" aria-label={`New Studio item in ${spaceName}`} title="New Studio item" className={cn(SIDEBAR_CONTROL_BUTTON_CLASS, "inline-flex items-center justify-center")} onClick={(event) => event.stopPropagation()}>
          <Icon name="Plus" className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48" aria-label={`New in ${spaceName}`}>
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

/** Opens a row's context menu from its ⋯, below the button, as right-click would. */
function openMenu(button: HTMLElement) {
  const rect = button.getBoundingClientRect();
  button.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: rect.left, clientY: rect.bottom }));
}

/**
 * An open Studio item: click opens it in the main pane, ⌘/Ctrl-click in a
 * split beside it, as a thread row does; right-click or ⋯ has the rest, as a thread's menu does.
 */
function StudioItemRow({ item, onClose }: { item: OpenItem; onClose(): void }) {
  const sdk = useSdk();
  const link = useRef<HTMLAnchorElement>(null);
  const canFloat = useCanFloat({ kind: "path", path: item.href, title: item.title });
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
        <div className="group/item relative" data-space-studio-item={`${item.pluginId}:${item.id}`}>
          <a
            ref={link}
            href={item.href}
            title={item.title}
            onClick={(event) => {
              // The split's own Mod-click goes on to BB.
              if (splitting || event.button !== 0 || event.shiftKey || event.altKey) return;
              event.preventDefault();
              openStudioItem(link.current, item.href, event.metaKey || event.ctrlKey);
            }}
            onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); onClose(); } }}
            className={cn(SIDEBAR_ROW_BASE_CLASS, SIDEBAR_ROW_INTERACTIVE_STATE_CLASS, COARSE_POINTER_ROW_HEIGHT_CLASS, "h-auto flex-wrap items-center pr-12 pb-1.5 pl-2 text-left max-md:pointer-coarse:h-auto")}
            style={{ rowGap: 0 }}
          >
            <span className={cn(SIDEBAR_ROW_GLYPH_SLOT_CLASS, "size-4")}>
              {item.icon ? <span className="text-[13px] leading-none">{item.icon}</span> : <Icon name={item.kindIcon} className="size-4" />}
            </span>
            {/* Line one is as tall as the hover buttons, so they stay off the preview. */}
            {renaming ? null : <span className="flex h-7 min-w-0 flex-1 items-center max-md:pointer-coarse:h-9"><span className="truncate">{item.title}</span></span>}
            <span className="pointer-events-none min-w-0 basis-full truncate pl-6 text-xs leading-4 text-subtle-foreground">{item.preview ?? item.kindLabel}</span>
          </a>
          {renaming ? null : (
            <span className="pointer-events-none absolute top-0 right-1 flex h-7 items-center gap-1 max-md:pointer-coarse:h-9 text-xs tabular-nums text-subtle-foreground group-hover/item:hidden group-focus-within/item:hidden">
              {item.pinned ? <Icon name="Pin" aria-label="Pinned" className="size-3" /> : null}
              {item.updatedAt ? compactAge(item.updatedAt) : null}
            </span>
          )}
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
              className="absolute inset-y-0.5 right-1 left-8 rounded-sm border border-sidebar-ring bg-sidebar px-1.5 text-sm outline-none"
            />
          ) : null}
          <span className="absolute top-0 right-0.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/item:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100 max-md:pointer-coarse:opacity-100">
            <button
              type="button"
              aria-label={`Close ${item.title}`}
              title="Close"
              onClick={onClose}
              className={cn(SIDEBAR_CONTROL_BUTTON_CLASS, "inline-flex items-center justify-center")}
            >
              <Icon name="X" className="size-3.5" />
            </button>
            <button
              type="button"
              aria-label={`${item.title} options`}
              title="Options"
              aria-haspopup="menu"
              onClick={(event) => openMenu(event.currentTarget)}
              className={cn(SIDEBAR_CONTROL_BUTTON_CLASS, "inline-flex items-center justify-center")}
            >
              <Icon name="MoreHorizontal" className="size-3.5" />
            </button>
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52" aria-label={`${item.title} actions`}>
        {canFloat ? <><ContextMenuItem onSelect={() => openFloat({ kind: "path", path: item.href, title: item.title })}><Icon name="AppWindow" className="size-4" />Float</ContextMenuItem><ContextMenuSeparator /></> : null}
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

/** The Space's items that aren't open, newest first; type to jump to one. */
function BrowseMenu({ spaceName, items, onPick }: { spaceName: string; items: readonly SpaceBrowseItem[]; onPick(href: string): void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`Open a Studio item in ${spaceName}`} title="Open an item" className={cn(SIDEBAR_CONTROL_BUTTON_CLASS, "inline-flex items-center justify-center")} onClick={(event) => event.stopPropagation()}>
          <Icon name="Layers" className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-64 overflow-auto" aria-label={`Studio items in ${spaceName}`}>
        {items.map((item) => (
          <DropdownMenuItem key={`${item.pluginId}:${item.id}`} textValue={item.title} onSelect={() => onPick(item.href)}>
            {item.icon ? <span className="w-4 text-center text-[13px] leading-none">{item.icon}</span> : <Icon name={item.kindIcon} className="size-4" />}
            <span className="min-w-0 flex-1 truncate">{item.title}</span>
            {item.updatedAt ? <span className="shrink-0 text-xs tabular-nums text-subtle-foreground">{compactAge(item.updatedAt)}</span> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A Space's open Studio items, like tabs: each opens in the main area, and ×
 * closes it here without touching the item. Opening any of the Space's items
 * adds it; + makes a new one in the Space and opens it.
 */
export function SpaceStudioList({ spaceId, spaceName, defaultProjectId, items }: {
  spaceId: string;
  spaceName: string;
  defaultProjectId: string | null;
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
  const total = items?.count ?? 0;
  const close = (item: SpaceItems["open"][number]) => {
    setClosed((current) => new Set(current).add(key(item)));
    void sdk.plugins.callRpc({ pluginId: "studio", method: "closeTabs", input: { items: [{ pluginId: item.pluginId, id: item.id }] } as never, outputSchema: z.object({ ok: z.boolean() }), signal: AbortSignal.timeout(15_000) })
      .catch(() => setClosed((current) => { const next = new Set(current); next.delete(key(item)); return next; }));
  };
  const openKeys = new Set(open.map(key));
  const browsable = (items?.all ?? []).filter((item) => !openKeys.has(key(item)));
  // Picked or made from a menu: open it, and list it as open in the Space.
  const openPicked = (href: string) => {
    openStudioItem(null, href);
    void sdk.plugins.callRpc({ pluginId: "studio", method: "visitTab", input: { path: href } as never, outputSchema: z.unknown(), signal: AbortSignal.timeout(15_000) }).catch(() => {});
  };
  return (
    <div role="group" aria-label={`${spaceName} Studio items`}>
      <SpaceSubheading
        title="Studio"
        action={(
          <span className="inline-flex items-center gap-0.5">
            {browsable.length ? <BrowseMenu spaceName={spaceName} items={browsable} onPick={openPicked} /> : null}
            <NewItemMenu spaceId={spaceId} spaceName={spaceName} defaultProjectId={defaultProjectId} onCreated={openPicked} />
          </span>
        )}
      />
      {open.map((item) => (
        <StudioItemRow key={key(item)} item={item} onClose={() => close(item)} />
      ))}
      {open.length ? null : (
        <EmptyState
          message={total ? "Nothing open" : "No items"}
          icon="File"
          className="px-2 py-0.5"
          iconClassName="size-3.5 text-subtle-foreground/50"
          messageClassName="text-xs leading-4 text-subtle-foreground/60"
        />
      )}
    </div>
  );
}
