import { join } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import Database from "better-sqlite3";
import { MIGRATIONS } from "../../migrations";
import { StudioServices } from "../../services";
import { registerMinis } from "../server";
import { MiniStore, MINI_TABLES } from "../server/store";

export const SHELF_DIR = join(import.meta.dirname, "..", "..", "..", "shelf");

/** An in-memory store with the mini app tables. */
export function memoryStore(now: () => number = Date.now) {
  const db = new Database(":memory:");
  db.exec(MINI_TABLES);
  return { db, store: new MiniStore(db, now) };
}

/** Studio on a fake host with only mini apps registered. */
export function miniHost(options: Parameters<typeof registerMinis>[4] = {}) {
  const host = createFakePluginHost({ pluginId: "studio", sdk: {
    plugins: { callRpc: async () => { throw new Error("not in this test"); } },
    threads: { list: async () => [{ id: "thr_1", title: "Planning", updatedAt: "2026-10-01T00:00:00Z" }] },
  } });
  const db = host.bb.storage.database();
  db.exec(MIGRATIONS[0]!);
  db.exec(MINI_TABLES);
  const minis = registerMinis(host.bb, db, new StudioServices(db), async () => {}, { shelfDirs: [SHELF_DIR], ...options });
  host.bb.onDispose(() => minis.dispose());
  return { ...host, minis };
}
