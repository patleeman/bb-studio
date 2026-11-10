import type {
  ExperimentalProjectActionsContextMenuProps,
  ExperimentalProjectActionsMenuProps,
} from "@get-bb/plugin-sdk";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@bb/shared-ui/context-menu";
import { stripProjectThreads } from "@/hooks/queries/project-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import {
  ProjectActionsMenu,
  ProjectActionsMenuItems,
} from "./ProjectActionsMenu";

function useProjectById(projectId: string) {
  const project = useSidebarNavigation().data?.projects.find(
    (candidate) => candidate.id === projectId,
  );
  return project === undefined ? null : stripProjectThreads(project);
}

export function PluginProjectActionsMenu({
  projectId,
  className,
}: ExperimentalProjectActionsMenuProps) {
  const project = useProjectById(projectId);
  return project === null ? null : (
    <ProjectActionsMenu project={project} triggerClassName={className} />
  );
}

export function PluginProjectActionsContextMenu({
  projectId,
  children,
}: ExperimentalProjectActionsContextMenuProps) {
  const project = useProjectById(projectId);
  if (project === null) return <>{children}</>;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent
        aria-label={`${project.name} actions`}
        onClick={(event) => event.stopPropagation()}
      >
        <ProjectActionsMenuItems project={project} surface="context" />
      </ContextMenuContent>
    </ContextMenu>
  );
}
