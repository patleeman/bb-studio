import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listDir, readText } from "./files";

let base = "";
let root = "";
beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "studio-code-files-"));
  root = join(base, "repo");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "a.ts"), "export const a = 1;\n");
  await writeFile(join(root, "bin.dat"), Buffer.from([1, 0, 2]));
  await writeFile(join(base, "secret.txt"), "nope");
  await symlink(join(base, "secret.txt"), join(root, "escape.txt"));
});
afterAll(() => rm(base, { recursive: true, force: true }));

describe("file browser", () => {
  it("lists folders first", async () => {
    const entries = await listDir([root], root);
    expect(entries.map((entry) => [entry.name, entry.dir])).toEqual([["src", true], ["bin.dat", false], ["escape.txt", false]]);
  });

  it("reads text and refuses binary files", async () => {
    expect((await readText([root], join(root, "src", "a.ts"))).text).toBe("export const a = 1;\n");
    expect((await readText([root], join(root, "bin.dat"))).reason).toBe("This file isn't text.");
  });

  it("refuses paths and symlinks outside the folders", async () => {
    await expect(readText([root], join(base, "secret.txt"))).rejects.toThrow("outside");
    await expect(readText([root], join(root, "escape.txt"))).rejects.toThrow("outside");
    await expect(listDir([root], join(root, ".."))).rejects.toThrow("outside");
  });
});
