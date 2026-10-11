// "Move to": one menu for moving Studio items to a project, from an item's
// ⋯ menu, a collection row, or the collection's bulk Move.
import { Icon } from "../ui/icon";
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from "../ui/dropdown-menu";
import { useProjects, type Project } from "./pieces";

export type ItemRef = { pluginId: string; id: string };

/**
 * The choices of a Move to menu: Global and the projects. `projectId` is
 * where the items are now, or undefined when they're in different places.
 */
export function MoveToItems({
  projects: given,
  projectId,
  onProject,
}: {
  /** The items being moved. */
  items: readonly ItemRef[];
  /** Fetched when left out. */
  projects?: readonly Project[];
  projectId?: string | null;
  onProject(projectId: string | null): void;
  /** Unused: kept for callers from when the menu also listed Spaces. */
  onMoved?(): void;
}) {
  const fetched = useProjects();
  const projects = given ?? fetched;
  return (
    <>
      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Projects</DropdownMenuLabel>
      <DropdownMenuItem disabled={projectId === null} onSelect={() => onProject(null)}>
        <Icon name="Globe" className="size-4" /> Global
        {projectId === null ? <Icon name="Check" className="ml-auto size-3.5" /> : null}
      </DropdownMenuItem>
      {projects.map((project) => (
        <DropdownMenuItem key={project.id} disabled={project.id === projectId} onSelect={() => onProject(project.id)}>
          <Icon name="Folder" className="size-4" />
          <span className="truncate">{project.name}</span>
          {project.id === projectId ? <Icon name="Check" className="ml-auto size-3.5" /> : null}
        </DropdownMenuItem>
      ))}
    </>
  );
}

/** "Move to ▸" for a menu: the projects in a submenu. */
export function MoveToSubmenu(props: Parameters<typeof MoveToItems>[0]) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Icon name="MoveTo" className="size-4" /> Move to
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-96 w-60 overflow-y-auto">
        <MoveToItems {...props} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
