import { createHash, randomUUID } from "node:crypto";
import { chmodSync, closeSync, cpSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";

const legacyModules = [
  ["tables", "studio-tables"], ["chat", "studio-chat"], ["feed", "feed"],
  ["tasks", "studio-tasks"], ["teams", "bot-teams"], ["artifacts", "artifacts"],
  ["decisions", "smart-decisions"], ["talk", "talk"],
  ["sidebar", "thread-list-plus"], ["navigation", "studio-navigation"], ["explore", "explore"],
] as const;
type Entry = { pluginId: string; path: string; status: "ready" | "retained" | "removed"; reason: string | null; files: number; bytes: number };
type File = { sha256: string; bytes: number };
function inventory(path: string): Record<string, File> {
  const result: Record<string, File> = {};
  const visit = (dir: string, prefix: string) => {
    if (!lstatSync(dir).isDirectory()) throw new Error("Expected a real directory; links are not eligible");
    for (const name of readdirSync(dir).sort()) {
      const file = join(dir, name), key = prefix + name, stat = lstatSync(file);
      if (stat.isDirectory()) visit(file, key + "/");
      else if (stat.isFile()) result[key] = { sha256: createHash("sha256").update(readFileSync(file)).digest("hex"), bytes: stat.size };
      else throw new Error("Symbolic links and special files are not eligible");
    }
  };
  visit(path, ""); return result;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function protect(path: string) {
  const stat = lstatSync(path); chmodSync(path, stat.isDirectory() ? 0o700 : 0o600);
  if (stat.isDirectory()) for (const name of readdirSync(path)) protect(join(path, name));
}
function flush(path: string) {
  if (lstatSync(path).isDirectory()) for (const name of readdirSync(path)) flush(join(path, name));
  const fd = openSync(path, "r"); try { fsyncSync(fd); } finally { closeSync(fd); }
}

/** Explicit RPC only. Paths are fixed IDs beneath the server's own data directory. */
export async function cleanupLegacyModules(options: {
  dataDir: string; dryRun: boolean;
  open: (path: string, options?: Database.Options) => Database.Database;
  installed: () => Promise<readonly { id: string }[]>;
}) {
  const { dataDir, dryRun, open, installed } = options;
  for (const path of [join(dataDir, "plugins"), join(dataDir, "plugins", "studio")]) {
    if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) throw new Error("Cleanup requires real plugin directories");
  }
  const registered = new Set((await installed()).map(plugin => plugin.id));
  const entries: Entry[] = [];
  const plans: { entry: Entry; files: Record<string, File>; settings: unknown[] }[] = [];
  for (const [module, pluginId] of legacyModules) {
    const path = join(dataDir, "plugins", pluginId);
    if (!existsSync(path)) continue;
    const entry: Entry = { pluginId, path, status: "retained", reason: null, files: 0, bytes: 0 };
    entries.push(entry);
    try {
      if (registered.has(pluginId)) throw new Error("Uninstall the legacy plugin after importing it before cleanup");
      const files = inventory(path);
      entry.files = Object.keys(files).length; entry.bytes = Object.values(files).reduce((n, file) => n + file.bytes, 0);
      const allowed = new Set(["data.db", "data.db-wal", "data.db-shm", "secrets", ...(module === "talk" ? ["audio"] : [])]);
      if (readdirSync(path).some(name => !allowed.has(name))) throw new Error(module === "teams" ? "Bot homes or other live files remain in this directory" : "Unrecognized files remain; preserve them for review");
      const target = join(dataDir, "plugins", module === "explore" ? "pages" : "studio", `${module}.db`);
      const db = open(target, { readonly: true, fileMustExist: true });
      let settings: unknown[] = [];
      try {
        const receipt = db.prepare("SELECT source, imported_at FROM module_imports WHERE module = ? AND legacy_plugin_id = ?").get(module, pluginId) as { source: string | null; imported_at: number } | undefined;
        if (!receipt) throw new Error("No completed import receipt");
        const source = join(path, "data.db");
        if (existsSync(source) && receipt.source !== source) throw new Error("Import receipt does not cover this database");
        for (const name of ["data.db", "data.db-wal"]) {
          const file = join(path, name);
          if (existsSync(file) && lstatSync(file).mtimeMs > receipt.imported_at + 1000) throw new Error("Legacy database changed after import; preserve it for review");
        }
        if (existsSync(join(path, "secrets"))) for (const key of readdirSync(join(path, "secrets"))) {
          if (!db.prepare("SELECT 1 FROM studio_module_settings_imports WHERE key = ?").get(key)) throw new Error("A legacy secret has no completed settings import");
        }
        if (existsSync(join(path, "audio")) && !db.prepare("SELECT 1 FROM module_file_imports WHERE source = ?").get(join(path, "audio"))) throw new Error("Audio import is not complete");
        if (db.pragma("quick_check", { simple: true }) !== "ok") throw new Error("Imported database did not pass integrity checking");
        settings = db.prepare("SELECT kind, key, value, updated_at FROM studio_module_state ORDER BY kind, key").all();
      } finally { db.close(); }
      entry.status = "ready"; plans.push({ entry, files, settings });
    } catch (error) { entry.reason = error instanceof Error ? error.message : String(error); }
  }
  if (dryRun || !plans.length) return { dryRun, archivePath: null, entries };
  const archiveRoot = join(dataDir, "plugins", "studio", "legacy-archives");
  if (existsSync(archiveRoot) && !lstatSync(archiveRoot).isDirectory()) throw new Error("Archive root must be a real directory");
  const archivePath = join(archiveRoot, `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`);
  mkdirSync(archivePath, { recursive: true, mode: 0o700 });
  chmodSync(archivePath, 0o700);
  const manifest = () => writeFileSync(join(archivePath, "manifest.json"), JSON.stringify({ createdAt: new Date().toISOString(), entries, files: Object.fromEntries(plans.map(plan => [plan.entry.pluginId, plan.files])) }, null, 2), { mode: 0o600 });
  // Back up every eligible directory before removing any. A failed copy leaves all sources intact.
  for (const { entry, files, settings } of plans) {
    const destination = join(archivePath, entry.pluginId);
    cpSync(entry.path, destination, { recursive: true, force: false, errorOnExist: true }); protect(destination);
    if (!same(inventory(destination), files)) throw new Error(`Archive verification failed; all source directories retained: ${archivePath}`);
    writeFileSync(join(archivePath, `${entry.pluginId}-settings.json`), JSON.stringify(settings, null, 2), { mode: 0o600 });
  }
  manifest();
  flush(archivePath);
  const parent = openSync(archiveRoot, "r"); try { fsyncSync(parent); } finally { closeSync(parent); }
  for (const { entry, files } of plans) {
    if ((await installed()).some(plugin => plugin.id === entry.pluginId) || !same(inventory(entry.path), files)) {
      entry.status = "retained"; entry.reason = "Legacy plugin or files changed during backup"; manifest(); continue;
    }
    // Quarantine by rename before the final comparison so a recreated path is never deleted.
    const quarantine = join(archivePath, `${entry.pluginId}.removing`);
    renameSync(entry.path, quarantine);
    if (!same(inventory(quarantine), files)) {
      if (!existsSync(entry.path)) renameSync(quarantine, entry.path);
      entry.status = "retained"; entry.reason = "Files changed during cleanup; retained at original path or archive .removing directory";
    } else { rmSync(quarantine, { recursive: true }); entry.status = "removed"; }
    manifest();
  }
  return { dryRun, archivePath, entries };
}
