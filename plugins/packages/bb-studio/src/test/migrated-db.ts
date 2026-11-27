import { writeFileSync } from "node:fs";
import Database from "better-sqlite3";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { MIGRATIONS } from "../migrations";

let pluginTemplate: Buffer | null = null;
let sqlTemplate: Buffer | null = null;

function getPluginTemplate(): Buffer {
  if (!pluginTemplate) {
    const { bb, harness } = createFakePluginHost({ pluginId: "studio" });
    const mem = new Database(":memory:");
    try {
      bb.storage.migrate(mem as unknown as ReturnType<typeof bb.storage.database>, MIGRATIONS);
      pluginTemplate = mem.serialize();
    } finally {
      mem.close();
      void harness.lifecycle.dispose();
    }
  }
  return pluginTemplate;
}

function getSqlTemplate(): Buffer {
  if (!sqlTemplate) {
    const db = new Database(":memory:");
    try {
      for (const sql of MIGRATIONS.filter(Boolean)) db.exec(sql);
      sqlTemplate = db.serialize();
    } finally {
      db.close();
    }
  }
  return sqlTemplate;
}

/**
 * Returns a fresh, isolated in-memory SQLite database with all Studio
 * `MIGRATIONS` applied via `bb.storage.migrate` (matching `createFakePluginHost`).
 */
export function migratedPluginDb(): Database.Database {
  return new Database(getPluginTemplate());
}

/**
 * Returns a fresh, isolated in-memory SQLite database with all Studio
 * `MIGRATIONS` applied directly via `db.exec`.
 */
export function migratedSqlDb(): Database.Database {
  return new Database(getSqlTemplate());
}

/**
 * Writes the pre-migrated SQLite template to `filePath` and opens it.
 */
export function migratedSqlFileDb(filePath: string): Database.Database {
  writeFileSync(filePath, getSqlTemplate());
  return new Database(filePath);
}
