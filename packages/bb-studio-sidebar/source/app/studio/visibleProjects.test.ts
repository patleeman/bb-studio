import { describe, expect, it } from "vitest";
import type { SidebarProject } from "../model/use-sidebar-data.js";
import { visibleProjects } from "./visibleProjects.js";

const project = (id: string, threadIds: string[] = []): SidebarProject => ({
  id,
  name: id,
  href: `/projects/${id}`,
  settingsHref: `/settings/projects/${id}`,
  isPersonal: false,
  threads: threadIds.map((threadId) => ({ id: threadId } as SidebarProject["threads"][number])),
});

describe("empty project visibility", () => {
  const projects = [project("empty"), project("visible", ["selected"]), project("archived", ["archived-thread"])];
  const threadsByProject = new Map<string, readonly unknown[]>([["visible", [{}]]]);
  const options = { projects, threadsByProject, dragging: false, ready: true };

  it("shows all projects by default and hides those without visible threads when enabled", () => {
    expect(visibleProjects({ ...options, hideEmptyProjects: false }).map((item) => item.id)).toEqual(["empty", "visible", "archived"]);
    expect(visibleProjects({ ...options, hideEmptyProjects: true }).map((item) => item.id)).toEqual(["visible"]);
  });

  it("keeps the selected, created, and renamed projects visible", () => {
    expect(visibleProjects({ ...options, hideEmptyProjects: true, selectedThreadId: "archived-thread", createdProjectId: "empty" }).map((item) => item.id)).toEqual(["empty", "visible", "archived"]);
    expect(visibleProjects({ ...options, hideEmptyProjects: true, renamingProjectId: "empty" }).map((item) => item.id)).toEqual(["empty", "visible"]);
  });

  it("shows drop targets during drag and while thread data loads", () => {
    expect(visibleProjects({ ...options, hideEmptyProjects: true, dragging: true })).toHaveLength(3);
    expect(visibleProjects({ ...options, hideEmptyProjects: true, ready: false })).toHaveLength(3);
  });
});
