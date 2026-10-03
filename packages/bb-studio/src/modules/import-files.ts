import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type Database from "better-sqlite3";

function inventory(directory: string, prefix = ""): Record<string, string> {
  const files: Record<string, string> = {};
  if (!existsSync(directory)) return files;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = join(prefix, entry.name), path = join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(files, inventory(path, name));
    else if (entry.isFile()) files[name] = createHash("sha256").update(readFileSync(path)).digest("hex");
    else throw new Error(`Unsupported legacy module file: ${name}`);
  }
  return files;
}

/** Copy stopped module-owned files before opening their new writer. Keep originals. */
export function importModuleFiles(db: Database.Database, source: string, target: string): void {
  db.exec("CREATE TABLE IF NOT EXISTS module_file_imports (target TEXT PRIMARY KEY, source TEXT NOT NULL, files INTEGER NOT NULL, imported_at INTEGER NOT NULL)");
  if (db.prepare("SELECT 1 FROM module_file_imports WHERE target = ?").get(target)) return;
  const expected = inventory(source);
  const verify = (directory: string) => {
    const actual = inventory(directory);
    if (JSON.stringify(Object.entries(actual).sort()) !== JSON.stringify(Object.entries(expected).sort()))
      throw new Error("Module file import differs from its source; preserved both directories");
  };
  if (existsSync(target)) verify(target); // Recover a crash after publishing the copy.
  else {
    const temporary = `${target}.importing`;
    rmSync(temporary, { recursive: true, force: true });
    try {
      mkdirSync(temporary, { recursive: true });
      if (existsSync(source)) cpSync(source, temporary, { recursive: true, errorOnExist: true, force: false });
      verify(temporary);
      renameSync(temporary, target);
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  }
  db.prepare("INSERT INTO module_file_imports VALUES (?, ?, ?, ?)").run(target, source, Object.keys(expected).length, Date.now());
}
