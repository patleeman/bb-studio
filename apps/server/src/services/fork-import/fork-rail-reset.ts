import Database from "better-sqlite3";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MARKER_FILE_NAME = "fork-rail-reset.json";
const RESET_KEYS = [
  "sidebar.pluginPanelOrder",
  "sidebar.visiblePluginPanels",
  "sidebar.hiddenFooterItems",
] as const;

export function resetForkRailPreferences(dataDir: string, now: number): void {
  const databasePath = join(dataDir, "bb.db");
  const markerPath = join(dataDir, MARKER_FILE_NAME);
  if (!existsSync(databasePath) || existsSync(markerPath)) return;
  const database = new Database(databasePath, { fileMustExist: true });
  try {
    const hasTable = database
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ui_preferences'",
      )
      .get();
    if (hasTable !== undefined) {
      const remove = database.prepare(
        "DELETE FROM ui_preferences WHERE key = ?",
      );
      database.transaction(() => {
        for (const key of RESET_KEYS) remove.run(key);
      })();
    }
  } finally {
    database.close();
  }
  writeFileSync(markerPath, `${JSON.stringify({ resetAt: now })}\n`);
}
