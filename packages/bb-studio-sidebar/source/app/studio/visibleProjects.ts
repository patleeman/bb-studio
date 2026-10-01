import type { SidebarProject } from "../model/use-sidebar-data.js";

export function visibleProjects({
  projects,
  threadsByProject,
  hideEmptyProjects,
  selectedThreadId,
  renamingProjectId,
  createdProjectId,
  dragging,
  ready,
}: {
  projects: readonly SidebarProject[];
  threadsByProject: ReadonlyMap<string, readonly unknown[]>;
  hideEmptyProjects: boolean;
  selectedThreadId?: string;
  renamingProjectId?: string;
  createdProjectId?: string | null;
  dragging: boolean;
  ready: boolean;
}): SidebarProject[] {
  return projects.filter(
    (project) =>
      !project.isPersonal &&
      (!hideEmptyProjects ||
        !ready ||
        dragging ||
        (threadsByProject.get(project.id)?.length ?? 0) > 0 ||
        project.threads.some((thread) => thread.id === selectedThreadId) ||
        project.id === renamingProjectId ||
        project.id === createdProjectId),
  );
}
