import { useRpc } from "@get-bb/plugin-sdk/app";
import type { ReactNode } from "react";
import { toast } from "sonner";
import type { StudioSchemas } from "../contract";
import { errorMessage } from "../format";
import { Icon } from "../ui/icon";
import { cn } from "../ui/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { copyItemReference } from "./item-reference";
import { MoveToSubmenu, type ItemRef } from "./move-to";
import { DANGER_BUTTON, FLOATING, GHOST_BUTTON, ICON_BUTTON, type Project } from "./pieces";
import type { StudioItemLink } from "./studio-item";

export function projectChoices(projects: readonly Project[]) {
  return [{ id: null, name: "Global" }, ...projects];
}

/** Copies a reference to `item`; pasted into a Studio item, it shows as a pill. */
function copyReferenceWithToast(item: StudioItemLink) {
  void copyItemReference(item).then((copied) => {
    if (copied) toast.success("Reference copied", { description: "Paste it into a page or another Studio item to link it." });
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
   * This item, in this plugin. With `projectId`, Move to offers Studio's
   * Spaces and every project, and moves through the plugin's `studio_move`
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
        {reference ? <CopyReferenceMenuItem item={reference} /> : null}
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
