import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "../migrations";
import { migrateOfficeSpaces } from "./migration";
import { OfficeSpaceStore } from "./space-store";
import { FolderService, folderSlug, type FolderProject } from "./folders";

function setup() {
  const db = new Database(":memory:");
  for (const sql of MIGRATIONS) db.exec(sql);
  migrateOfficeSpaces(db, { projectIds: [], projectForMember: () => undefined, logConflict: () => {} });
  const spaces = new OfficeSpaceStore(db);
  const space = spaces.create({ name: "Work" });
  const projects: FolderProject[] = [];
  const paths: string[] = [];
  let loseResponse = false;
  const host = {
    root: "/fixture/Spaces", mkdir: async (path: string) => { paths.push(path); },
    projects: async () => projects,
    createProject: async (name: string, path: string) => {
      const project = { id: `p${projects.length}`, name, path };
      projects.push(project);
      if (loseResponse) { loseResponse = false; throw new Error("lost response"); }
      return project;
    },
  };
  return { db, spaces, space, projects, paths, host, folders: new FolderService(db, spaces, host), loseResponse: () => { loseResponse = true; } };
}

describe("plain folders", () => {
  it("recovers a committed project after a lost response and process restart", async () => {
    const f = setup();
    f.loseResponse();
    await expect(f.folders.create(f.space.id, "Drafts")).rejects.toThrow("lost response");
    const restarted = new FolderService(f.db, f.spaces, f.host);
    const folder = await restarted.create(f.space.id, "Drafts");
    expect(f.projects).toHaveLength(1);
    expect(f.spaces.forProject(folder.id).id).toBe(f.space.id);
    await restarted.archive(folder.id);
    expect((await restarted.list(f.space.id))[0]?.archived).toBe(true);
    expect(f.projects).toHaveLength(1);
    f.db.close();
  });
  it("creates one project under concurrent calls and protects catch-all folders", async () => {
    const f = setup();
    const [a,b] = await Promise.all([f.folders.create(f.space.id, "Drafts"), f.folders.create(f.space.id, "Drafts")]);
    expect(a.id).toBe(b.id);
    await f.folders.ensureCatchAll(f.space.id);
    await f.folders.ensureCatchAll(f.space.id);
    expect(f.projects).toHaveLength(2);
    await expect(f.folders.archive(f.spaces.get(f.space.id).defaultProjectId!)).rejects.toThrow("catch-all");
    expect(folderSlug("../../escape / ü")).toBe("escape-u");
    expect(f.paths.every(p => p.startsWith("/fixture/Spaces/work-"))).toBe(true);
    f.db.close();
  });
});
