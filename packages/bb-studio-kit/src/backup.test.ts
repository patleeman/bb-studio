import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { mapProject, restoreDecision, RestoreTally, studioBackupSchemas } from "./backup";
import { backupSectionDir, BackupReader, fileSafeId, runBackup, runRestore, sectionPath } from "./server/backup";

const dirs: string[] = [];
async function temp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kit-backup-"));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("restore decisions", () => {
  it("creates, updates, skips re-runs and keeps newer local copies", () => {
    expect(restoreDecision(null, 5)).toBe("create");
    expect(restoreDecision(4, 5)).toBe("update");
    expect(restoreDecision(5, 5)).toBe("unchanged");
    expect(restoreDecision(6, 5)).toBe("keep");
  });

  it("maps projects and turns unknown ones global", () => {
    expect(mapProject({ a: "b" }, "a")).toEqual({ projectId: "b", unmapped: false });
    expect(mapProject({ a: null }, "a")).toEqual({ projectId: null, unmapped: true });
    expect(mapProject({}, "x")).toEqual({ projectId: null, unmapped: true });
    expect(mapProject({}, null)).toEqual({ projectId: null, unmapped: false });
  });

  it("tallies outcomes with reasons for kept items", () => {
    const tally = new RestoreTally();
    tally.decided("create", { id: "a" });
    tally.decided("keep", { id: "b", title: "B" });
    tally.unmapped({ id: "c" });
    const report = tally.result();
    expect(report).toMatchObject({ created: 1, kept: 1, unmapped: 1 });
    expect(report.problems.map((problem) => problem.id)).toEqual(["b", "c"]);
    expect(studioBackupSchemas(z).report.parse(report)).toEqual(report);
  });
});

describe("section paths", () => {
  it("refuses paths outside the section", () => {
    const root = "/data/section";
    expect(sectionPath(root, "items/a.json")).toBe("/data/section/items/a.json");
    for (const bad of ["../x", "/etc/passwd", "a/../../x", "a\\b", "", "a//b", "./a"]) expect(() => sectionPath(root, bad)).toThrow(/Refusing/);
  });

  it("refuses malformed sessions and ids", () => {
    expect(() => backupSectionDir("/d", "../x", "pages")).toThrow();
    expect(() => backupSectionDir("/d", "bk_abcdefgh12", "../studio")).toThrow();
    expect(backupSectionDir("/d", "bk_abcdefgh12", "pages")).toBe("/d/plugins/studio/backup-sessions/bk_abcdefgh12/pages");
    expect(fileSafeId("pg_1a")).toBe("pg_1a");
    expect(() => fileSafeId("../x")).toThrow();
  });
});

describe("runBackup and runRestore", () => {
  it("writes a section and reads it back", async () => {
    const root = await temp();
    const source = join(root, "audio.bin");
    await writeFile(source, Buffer.from([1, 2, 3]));
    const dir = join(root, "session", "talk");
    const result = await runBackup(dir, {
      version: 1,
      async backup(writer) {
        await writer.json("items/a.json", { id: "a" });
        await writer.copy("files/a/audio.bin", source);
        return { counts: { items: 1 } };
      },
      restore: async () => {},
    });
    expect(result).toMatchObject({ version: 1, counts: { items: 1 }, files: 2 });
    const reader = new BackupReader(dir);
    expect(await reader.list("items")).toEqual(["a.json"]);
    expect(await reader.list("missing")).toEqual([]);
    expect(await reader.json("items/a.json")).toEqual({ id: "a" });
    expect([...(await reader.bytes("files/a/audio.bin"))]).toEqual([1, 2, 3]);
    await expect(runBackup(dir, { version: 1, backup: async () => ({ counts: {} }), restore: async () => {} })).rejects.toThrow();
  });

  it("refuses a section from a newer add-on and reports through the tally", async () => {
    const dir = await temp();
    await mkdir(join(dir, "items"));
    await writeFile(join(dir, "items", "a.json"), "{}");
    const handlers = {
      version: 1,
      backup: async () => ({ counts: {} }),
      async restore(_reader: BackupReader, options: { tally: RestoreTally }) {
        options.tally.record("created");
      },
    };
    await expect(runRestore(dir, handlers, { dryRun: true, version: 2, projects: {} })).rejects.toThrow(/newer version/);
    expect(await runRestore(dir, handlers, { dryRun: true, version: 1, projects: {} })).toMatchObject({ created: 1 });
    expect(await readFile(join(dir, "items", "a.json"), "utf8")).toBe("{}");
  });
});

it("maps projects by own keys only", async () => {
  const { mapProject } = await import("./backup");
  expect(mapProject({ proj_a: "proj_b" }, "constructor")).toEqual({ projectId: null, unmapped: true });
  expect(mapProject({ proj_a: "proj_b" }, "proj_a")).toEqual({ projectId: "proj_b", unmapped: false });
});
