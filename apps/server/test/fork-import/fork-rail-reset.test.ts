import Database from "better-sqlite3";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetForkRailPreferences } from "../../src/services/fork-import/fork-rail-reset.js";

const dirs: string[] = [];

function dataDirWith(keys: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "fork-rail-reset-"));
  dirs.push(dir);
  const database = new Database(join(dir, "bb.db"));
  database.exec(
    "CREATE TABLE ui_preferences (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
  );
  for (const key of keys) {
    database
      .prepare("INSERT INTO ui_preferences VALUES (?, '[]', 1, 0)")
      .run(key);
  }
  database.close();
  return dir;
}

function storedKeys(dir: string): string[] {
  const database = new Database(join(dir, "bb.db"), { readonly: true });
  try {
    return database
      .prepare<[], { key: string }>(
        "SELECT key FROM ui_preferences ORDER BY key",
      )
      .all()
      .map((row) => row.key);
  } finally {
    database.close();
  }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
});

describe("fork rail reset", () => {
  it("drops the stored rail and footer preferences once and keeps the rest", () => {
    const dir = dataDirWith([
      "sidebar.pluginPanelOrder",
      "sidebar.visiblePluginPanels",
      "sidebar.hiddenFooterItems",
      "sidebar.threadListProvider",
    ]);
    resetForkRailPreferences(dir, 5);
    expect(storedKeys(dir)).toEqual(["sidebar.threadListProvider"]);
    expect(existsSync(join(dir, "fork-rail-reset.json"))).toBe(true);
  });

  it("marks a new data dir as reset, so a fresh install keeps the footer and rail it sets on its first run", () => {
    const dir = mkdtempSync(join(tmpdir(), "fork-rail-reset-"));
    dirs.push(dir);
    resetForkRailPreferences(dir, 5);
    expect(existsSync(join(dir, "fork-rail-reset.json"))).toBe(true);
    const database = new Database(join(dir, "bb.db"));
    database.exec(
      "CREATE TABLE ui_preferences (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
    );
    database
      .prepare(
        "INSERT INTO ui_preferences VALUES ('sidebar.hiddenFooterItems', '[]', 1, 0)",
      )
      .run();
    database.close();
    resetForkRailPreferences(dir, 9);
    expect(storedKeys(dir)).toEqual(["sidebar.hiddenFooterItems"]);
  });

  it("does nothing once the reset has run", () => {
    const dir = dataDirWith([]);
    resetForkRailPreferences(dir, 5);
    const database = new Database(join(dir, "bb.db"));
    database
      .prepare(
        "INSERT INTO ui_preferences VALUES ('sidebar.pluginPanelOrder', '[]', 1, 0)",
      )
      .run();
    database.close();
    resetForkRailPreferences(dir, 9);
    expect(storedKeys(dir)).toEqual(["sidebar.pluginPanelOrder"]);
  });
});
