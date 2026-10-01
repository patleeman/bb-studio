import type { ReactNode } from "react";
import { Icon } from "../ui/icon";
import { cn } from "../ui/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { DANGER_BUTTON, FLOATING, GHOST_BUTTON, ICON_BUTTON, projectName, type Project } from "./pieces";

export function projectChoices(projects: readonly Project[]) {
  return [{ id: null, name: "Global" }, ...projects];
}

export function ItemMenu({
  children,
  projects,
  projectId,
  onMove,
  onDelete,
  deleteDisabled,
  busy = false,
  className,
}: {
  children?: ReactNode;
  projects?: Project[];
  projectId?: string | null;
  onMove?(projectId: string | null): void;
  onDelete?(): void;
  deleteDisabled?: boolean;
  busy?: boolean;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="More" className={ICON_BUTTON}>
          <Icon name={busy ? "Loading" : "MoreHorizontal"} className={cn("size-4", busy && "animate-spin motion-reduce:animate-none")} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={cn("w-56", className)}>
        {children}
        {onMove && projects ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Icon name="MoveTo" className="size-4" /> Move to project
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-80 w-56 overflow-y-auto">
              <DropdownMenuLabel className="text-xs text-muted-foreground">Now in {projectName(projects, projectId ?? null)}</DropdownMenuLabel>
              {projectChoices(projects).map((project) => (
                <DropdownMenuItem key={project.id ?? "global"} disabled={project.id === (projectId ?? null)} onSelect={() => onMove(project.id)}>
                  <Icon name={project.id ? "Folder" : "Globe"} className="size-4" /> {project.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
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
