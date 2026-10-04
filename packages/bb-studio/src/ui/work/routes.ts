// Where a project lives: the Projects panel, with the project id as its
// sub-path. The panel root lists every project.
import { panelHref } from "@bb-studio/kit/app";

export const PROJECTS_PANEL = "projects";

export function projectPath(projectId: string): string {
  return panelHref("studio", PROJECTS_PANEL, projectId);
}

/** The project a Projects panel sub-path names, or null at the panel root. */
export function projectIdOf(subPath: string): string | null {
  const id = subPath.replace(/^\/+|\/+$/g, "").split("/")[0];
  return id ? decodeURIComponent(id) : null;
}
