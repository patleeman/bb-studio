import { describe, expect, it } from "vitest";
import { autoFileFolder, pathProject, splitFolderPath } from "./auto-file";

const folders = new Map([["fld_a", { id: "fld_a", projectId: "p" }], ["fld_b", { id: "fld_b", projectId: "p" }], ["fld_q", { id: "fld_q", projectId: "q" }], ["fld_none", { id: "fld_none", projectId: null }]]);
const folder = (id: string) => folders.get(id) ?? null;

describe("where automatic filing puts a new thing", () => {
  it("beside the thread that made it", () => {
    expect(autoFileFolder({ current: null, projectId: "p", sources: [{ folderId: "fld_a" }], folder })).toBe("fld_a");
  });

  it("beside the first source that is in a folder: the thread, then the item above", () => {
    expect(autoFileFolder({ current: null, projectId: "p", sources: [null, { folderId: "fld_b" }], folder })).toBe("fld_b");
    expect(autoFileFolder({ current: null, projectId: "p", sources: [{ folderId: null }, { folderId: "fld_b" }], folder })).toBe("fld_b");
    expect(autoFileFolder({ current: null, projectId: "p", sources: [{ folderId: "fld_a" }, { folderId: "fld_b" }], folder })).toBe("fld_a");
  });

  it("nowhere when the source sits at its project's root, or its folder is gone", () => {
    expect(autoFileFolder({ current: null, projectId: "p", sources: [null], folder })).toBeNull();
    expect(autoFileFolder({ current: null, projectId: "p", sources: [{ folderId: null }], folder })).toBeNull();
    expect(autoFileFolder({ current: null, projectId: "p", sources: [{ folderId: "fld_gone" }], folder })).toBeNull();
  });

  it("never across projects: a global page made in a project's thread stays in No project", () => {
    expect(autoFileFolder({ current: null, projectId: null, sources: [{ folderId: "fld_a" }], folder })).toBeNull();
    expect(autoFileFolder({ current: null, projectId: "p", sources: [{ folderId: "fld_q" }], folder })).toBeNull();
    expect(autoFileFolder({ current: null, projectId: null, sources: [{ folderId: "fld_none" }], folder })).toBe("fld_none");
  });

  it("leaves alone anything already filed, by the user, an agent or an earlier automatic filing", () => {
    for (const filedBy of ["user", "agent", "auto"] as const) expect(autoFileFolder({ current: { filedBy }, projectId: "p", sources: [{ folderId: "fld_a" }], folder })).toBeNull();
  });
});

describe("a folder path", () => {
  it("splits on slashes and drops empty parts", () => {
    expect(splitFolderPath(" Website / Plans//Q3 /")).toEqual(["Website", "Plans", "Q3"]);
    expect(splitFolderPath(" / ")).toEqual([]);
  });

  it("starts with a project by name or id without case, or No project", () => {
    const projects = [{ id: "proj_1", name: "Website" }, { id: "proj_2", name: "website v2" }];
    expect(pathProject("website", projects)).toEqual({ projectId: "proj_1" });
    expect(pathProject("proj_2", projects)).toEqual({ projectId: "proj_2" });
    expect(pathProject("No Project", projects)).toEqual({ projectId: null });
    expect(pathProject("global", projects)).toEqual({ projectId: null });
    expect(pathProject("Nope", projects)).toBeNull();
  });
});
