import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { importModuleFiles } from "./import-files";
it("imports exact file bytes once, retains originals, and preserves later edits/deletions", () => {
  const root = mkdtempSync(join(tmpdir(), "studio-file-import-")); const db = new Database(":memory:");
  const source = join(root, "old"), target = join(root, "new");
  try {
    mkdirSync(join(source, "recording"), { recursive: true });
    const bytes = Buffer.from([0, 255, 4, 10]); writeFileSync(join(source, "recording", "audio.wav"), bytes);
    importModuleFiles(db, source, target);
    expect(readFileSync(join(target, "recording", "audio.wav"))).toEqual(bytes);
    expect(readFileSync(join(source, "recording", "audio.wav"))).toEqual(bytes);
    db.prepare("DELETE FROM module_file_imports").run(); importModuleFiles(db, source, target);
    rmSync(join(target, "recording"), { recursive: true }); importModuleFiles(db, source, target);
    expect(db.prepare("SELECT files FROM module_file_imports").get()).toEqual({ files: 1 });
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});
it("refuses to replace an existing different destination", () => {
  const root = mkdtempSync(join(tmpdir(), "studio-file-conflict-")); const db = new Database(":memory:");
  try {
    for (const directory of ["old", "new"]) { mkdirSync(join(root, directory)); writeFileSync(join(root, directory, "audio"), directory); }
    expect(() => importModuleFiles(db, join(root, "old"), join(root, "new"))).toThrow("differs");
    expect(readFileSync(join(root, "new", "audio"), "utf8")).toBe("new");
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});
