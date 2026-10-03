import Database from "better-sqlite3";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { importModule } from "./import";
import { cleanupLegacyModules } from "./cleanup";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
async function fixture(module = "tables", pluginId = "studio-tables") {
  const dataDir = mkdtempSync(join(tmpdir(), "studio-cleanup-")); roots.push(dataDir);
  const path = join(dataDir, "plugins", pluginId); mkdirSync(path, { recursive: true });
  const db = new Database(join(path, "data.db")); db.exec("CREATE TABLE data (value TEXT); INSERT INTO data VALUES ('keep 雪')"); db.close();
  const core = new Database(":memory:");
  const open = (path: string, options?: Database.Options) => new Database(path, options);
  const target = await importModule({ dataDir, module, legacyPluginId: pluginId, core, open, legacyRunning: false }); core.close();
  return { path, target, options: { dataDir, open, installed: async () => [] as { id: string }[], dryRun: true } };
}
it("dry run reads without writing; execution archives exact bytes and imported settings before removal", async () => {
  const { path, target, options } = await fixture();
  const imported = new Database(target); imported.prepare("INSERT INTO studio_module_state VALUES ('settings', 'theme', ?, 123)").run('"dark"'); imported.close();
  const original = readFileSync(join(path, "data.db"));
  const preview = await cleanupLegacyModules(options);
  expect(preview.entries[0].status).toBe("ready"); expect(preview.archivePath).toBeNull();
  expect(existsSync(join(options.dataDir, "plugins/studio/legacy-archives"))).toBe(false);
  expect(readFileSync(join(path, "data.db"))).toEqual(original);
  const result = await cleanupLegacyModules({ ...options, dryRun: false });
  expect(result.entries[0].status).toBe("removed"); expect(existsSync(path)).toBe(false);
  expect(readFileSync(join(result.archivePath!, "studio-tables/data.db"))).toEqual(original);
  expect(JSON.parse(readFileSync(join(result.archivePath!, "studio-tables-settings.json"), "utf8"))).toContainEqual({ kind: "settings", key: "theme", value: '"dark"', updated_at: 123 });
  expect(lstatSync(result.archivePath!).mode & 0o777).toBe(0o700);
  expect(lstatSync(join(result.archivePath!, "studio-tables/data.db")).mode & 0o777).toBe(0o600);
  expect(existsSync(target)).toBe(true);
  expect((await cleanupLegacyModules({ ...options, dryRun: false })).entries).toEqual([]);
});
it("retains installed plugins, missing imports, and unknown live files", async () => {
  const { path, target, options } = await fixture();
  expect((await cleanupLegacyModules({ ...options, installed: async () => [{ id: "studio-tables" }] })).entries[0].reason).toMatch(/Uninstall/);
  writeFileSync(join(path, "live-file"), "keep");
  expect((await cleanupLegacyModules(options)).entries[0].reason).toMatch(/Unrecognized/);
  rmSync(join(path, "live-file"));
  const db = new Database(target); db.exec("DELETE FROM module_imports"); db.close();
  expect((await cleanupLegacyModules({ ...options, dryRun: false })).entries[0].reason).toMatch(/receipt/);
  expect(existsSync(path)).toBe(true);
});
it("preserves bot homes and refuses symbolic links", async () => {
  const { path, options } = await fixture("teams", "bot-teams");
  mkdirSync(join(path, "homes"));
  expect((await cleanupLegacyModules(options)).entries[0].reason).toMatch(/Bot homes/);
  rmSync(join(path, "homes"), { recursive: true }); symlinkSync(join(options.dataDir, "plugins/studio"), join(path, "escape"));
  expect((await cleanupLegacyModules(options)).entries[0].reason).toMatch(/links/);
});
it("retains source if a plugin is reinstalled while the archive is being made", async () => {
  const { path, options } = await fixture(); let calls = 0;
  const result = await cleanupLegacyModules({ ...options, dryRun: false, installed: async () => ++calls === 1 ? [] : [{ id: "studio-tables" }] });
  expect(result.entries[0].status).toBe("retained"); expect(existsSync(path)).toBe(true);
  expect(existsSync(join(result.archivePath!, "studio-tables/data.db"))).toBe(true);
});
it("retains audio until its separate file import completes", async () => {
  const { path, options } = await fixture("talk", "talk"); mkdirSync(join(path, "audio"));
  writeFileSync(join(path, "audio", "clip.wav"), "fixture");
  expect((await cleanupLegacyModules({ ...options, dryRun: false })).entries[0].status).toBe("retained");
  expect(existsSync(join(path, "audio/clip.wav"))).toBe(true);
});

it("retains a database changed after its import", async () => {
  const { path, options } = await fixture();
  const future = new Date(Date.now() + 60_000);
  utimesSync(join(path, "data.db"), future, future);
  const result = await cleanupLegacyModules({ ...options, dryRun: false });
  expect(result.entries[0].reason).toMatch(/changed after import/);
  expect(result.archivePath).toBeNull(); expect(existsSync(path)).toBe(true);
});
