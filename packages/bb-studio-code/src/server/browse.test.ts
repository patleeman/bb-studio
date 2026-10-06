import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { browseFolders } from "./folders";

let home = "";
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "studio-code-browse-"));
  for (const dir of ["code/app", "code/lib", "Documents", ".ssh", ".config/gh", ".config/nvim"]) await mkdir(join(home, dir), { recursive: true });
  await writeFile(join(home, "notes.txt"), "not a folder");
  await symlink(join(home, "code/app"), join(home, "app-link"));
});
afterAll(() => rm(home, { recursive: true, force: true }));

describe("folder picker", () => {
  it("starts at home and lists folders only, sorted, hidden ones left out", async () => {
    const result = await browseFolders(null, home, false);
    expect(result.path).toBe(home);
    expect(result.folders.map((folder) => folder.name)).toEqual(["app-link", "code", "Documents"]);
  });

  it("can't choose home itself, but can choose a folder in it", async () => {
    expect((await browseFolders(null, home, false)).choosable).toBe(false);
    const code = await browseFolders(join(home, "code"), home, false);
    expect(code.choosable).toBe(true);
    expect(code.parent).toBe(home);
    expect(code.folders.map((folder) => [folder.name, folder.choosable])).toEqual([["app", true], ["lib", true]]);
  });

  it("shows hidden folders on request, but never secret ones", async () => {
    const all = await browseFolders(null, home, true);
    expect(all.folders.map((folder) => folder.name)).toEqual(["app-link", "code", "Documents", ".config"]);
    // .config holds .config/gh, so it can be walked through but not chosen.
    expect(all.folders.find((folder) => folder.name === ".config")?.choosable).toBe(false);
    const config = await browseFolders(join(home, ".config"), home, true);
    expect(config.folders.map((folder) => folder.name)).toEqual(["nvim"]);
  });

  it("won't list inside a secret folder", async () => {
    await expect(browseFolders(join(home, ".ssh"), home, true)).rejects.toThrow(/secrets/);
  });

  it("refuses relative paths and files", async () => {
    await expect(browseFolders("code", home, false)).rejects.toThrow(/full path/);
    await expect(browseFolders(join(home, "notes.txt"), home, false)).rejects.toThrow(/folder/);
  });
});
