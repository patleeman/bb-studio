import { useRpc } from "@get-bb/plugin-sdk/app";
import type { ReactNode } from "react";
import { toast } from "sonner";
import type { StudioSchemas } from "../contract";
import { errorMessage } from "../format";
import { Icon } from "../ui/icon";
import { cn } from "../ui/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { parseStudioItemHref } from "../references";
import { useHomeThread, useItemChat } from "./item-chat";
import { copyItemReference } from "./item-reference";
import { OpenInWindowMenuItem } from "./item-window";
import { MoveToSubmenu, type ItemRef } from "./move-to";
import { DANGER_BUTTON, FLOATING, GHOST_BUTTON, ICON_BUTTON, type Project } from "./pieces";
import type { StudioItemLink } from "./studio-item";

/** Copies a reference to `item`; pasted into a Studio item, it shows as a pill. */
function copyReferenceWithToast(item: StudioItemLink) {
  void copyItemReference(item).then((copied) => {
    if (copied) toast.success("Reference copied");
    else toast.error("Couldn't copy the reference.");
  });
}

/** The Copy reference action, for an item's own menus. */
export function CopyReferenceMenuItem({ item }: { item: StudioItemLink }) {
  return (
    <DropdownMenuItem onSelect={() => copyReferenceWithToast(item)}>
      <Icon name="studio/link" fallback="Copy" className="size-4" /> Copy reference
    </DropdownMenuItem>
  );
}

/** The item a link is, as Studio's item chat knows it: a built-in kind by its own namespace, an add-on's by its plugin. */
export function linkedItemRef(href: string): { pluginId: string; id: string } | null {
  const builtin = parseStudioItemHref(href);
  if (builtin) return builtin;
  const path = href.split(/[?#]/)[0]?.split("/") ?? [];
  return path[1] === "plugins" && path[2] && path[2] !== "studio" && path[4] ? { pluginId: path[2], id: decodeURIComponent(path[4]) } : null;
}

/**
 * The thread linked to an item, for the item's own menus: open it, link
 * another, unlink. An item has no thread until one is linked or started
 * about it, so with none there is only "Link a thread…". Draws nothing
 * until Studio's item chat is up.
 */
export function LinkedThreadMenuItems({ href }: { href: string }) {
  const item = linkedItemRef(href);
  const host = useItemChat();
  const home = useHomeThread(item);
  if (!host || !item || home === undefined) return null;
  return (
    <>
      {home ? (
        <DropdownMenuItem onSelect={() => host.open(item)}>
          <Icon name="MessageSquare" className="size-4" /> <span className="truncate">Open “{home.title}”</span>
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem onSelect={() => host.choose(item)}>
        <Icon name="MoveTo" className="size-4" /> {home ? "Link another thread…" : "Link a thread…"}
      </DropdownMenuItem>
      {home ? (
        <DropdownMenuItem onSelect={() => void host.unlink(item)}>
          <Icon name="CircleX" className="size-4" /> Unlink thread
        </DropdownMenuItem>
      ) : null}
    </>
  );
}

export function ItemMenu({
  children,
  reference,
  item,
  projects,
  projectId,
  onMove,
  onMoved,
  onDelete,
  deleteDisabled,
  busy = false,
  className,
}: {
  children?: ReactNode;
  /** Adds Copy reference for this item. */
  reference?: StudioItemLink;
  /**
   * This item, in this plugin. With `projectId`, Move to offers every
   * project, and moves through the plugin's `studio_move`
   * unless `onMove` is given.
   */
  item?: ItemRef;
  projects?: Project[];
  projectId?: string | null;
  onMove?(projectId: string | null): void;
  /** After a move. */
  onMoved?(): void;
  onDelete?(): void;
  deleteDisabled?: boolean;
  busy?: boolean;
  className?: string;
}) {
  const rpc = useRpc<StudioSchemas["provider"]>();
  const moveHere = async (target: string | null) => {
    try {
      const { failed } = await rpc.call("studio_move", { ids: [item!.id], projectId: target });
      if (failed.length) throw new Error(failed[0]!.error);
      toast.success("Moved");
      onMoved?.();
    } catch (cause) {
      toast.error(`Couldn't move: ${errorMessage(cause)}`);
    }
  };
  const movable = onMove ? Boolean(projects || item) : Boolean(item && projectId !== undefined);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="More" className={ICON_BUTTON}>
          <Icon name={busy ? "Loading" : "MoreHorizontal"} className={cn("size-4", busy && "animate-spin motion-reduce:animate-none")} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={cn("w-56", className)}>
        {reference ? <OpenInWindowMenuItem href={reference.href} title={reference.title} /> : null}
        {reference ? <CopyReferenceMenuItem item={reference} /> : null}
        {reference ? <LinkedThreadMenuItems href={reference.href} /> : null}
        {children}
        {movable ? <MoveToSubmenu items={item ? [item] : []} projects={projects} projectId={projectId ?? null} onProject={onMove ?? ((target) => void moveHere(target))} onMoved={onMoved} /> : null}
        {onDelete ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" disabled={deleteDisabled} onSelect={onDelete}>
              <Icon name="Trash2" className="size-4" /> Delete…
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ItemDeleteConfirm({ label, onDelete, onCancel }: { label: string; onDelete(): void; onCancel(): void }) {
  return (
    <div className={cn(FLOATING, "flex items-center gap-1.5 rounded-md py-1 pr-1 pl-3 text-sm")}>
      <span className="max-sm:hidden">{label}</span>
      <button type="button" className={DANGER_BUTTON} onClick={onDelete}>Delete</button>
      <button type="button" className={GHOST_BUTTON} onClick={onCancel}>Cancel</button>
    </div>
  );
}
