import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "./migrations";
import { SpaceFolders, folderSlug, type FolderProject } from "./space-folders";
import { SpaceStore } from "./spaces";

function setup() {
  const db = new Database(":memory:");
  for (const sql of MIGRATIONS) db.exec(sql);
  const spaces = new SpaceStore(db);
  const space = spaces.create({ name: "Work" });
  const projects: FolderProject[] = [];
  const paths: string[] = [];
  let loseResponse = false;
  const host = {
    root: "/fixture/Spaces",
    mkdir: async (path: string) => { paths.push(path); },
    projects: async () => projects,
    createProject: async (name: string, path: string) => {
      const project = { id: `p${projects.length}`, name, path };
      projects.push(project);
      if (loseResponse) { loseResponse = false; throw new Error("lost response"); }
      return project;
    },
  };
  return { db, spaces, space, projects, paths, host, folders: new SpaceFolders(db, spaces, host), loseResponse: () => { loseResponse = true; } };
}

describe("space folders", () => {
  it("recovers a project made before a lost response, after a restart", async () => {
    const f = setup();
    f.loseResponse();
    await expect(f.folders.ensureCatchAll(f.space.id)).rejects.toThrow("lost response");
    await new SpaceFolders(f.db, f.spaces, f.host).ensureCatchAll(f.space.id);
    expect(f.projects).toHaveLength(1);
    expect(f.spaces.get(f.space.id)?.defaultProjectId).toBe("p0");
    expect(f.spaces.forProject("p0").id).toBe(f.space.id);
  });

  it("makes one catch-all under concurrent calls, in the space's own folder", async () => {
    const f = setup();
    await Promise.all([f.folders.ensureCatchAll(f.space.id), f.folders.ensureCatchAll(f.space.id)]);
    await f.folders.ensureCatchAll(f.space.id);
    expect(f.projects).toHaveLength(1);
    expect(f.paths.every((path) => path.startsWith(`/fixture/Spaces/work-${f.space.id}/general`))).toBe(true);
    expect(folderSlug("../../escape / ü")).toBe("escape-u");
  });

  it("adds a picked folder as a project once, and reuses one already there", async () => {
    const f = setup();
    const [a, b] = await Promise.all([f.folders.projectAt("/code/site/"), f.folders.projectAt("/code/site")]);
    expect(a).toEqual({ id: "p0", name: "site", path: "/code/site" });
    expect(b.id).toBe("p0");
    expect((await f.folders.projectAt("/code/site")).id).toBe("p0");
    expect(f.projects).toHaveLength(1);
  });
});
