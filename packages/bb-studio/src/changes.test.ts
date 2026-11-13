import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { MIGRATIONS } from "./migrations";
import { ChangeLog, recordProviderChanges } from "./changes";

describe("Studio change cursor", () => {
  it("catches up after an item changes", () => {
    const log = new ChangeLog();
    const first = log.append({ pluginId: "pages", id: "pg_1", kind: "page", removed: false, at: 100 });
    log.append({ pluginId: "pages", id: "pg_2", kind: "page", removed: true, at: 101 });
    expect(log.since(first)).toEqual({ cursor: 2, reset: false, changes: [{ pluginId: "pages", id: "pg_2", kind: "page", removed: true, at: 101 }] });
  });

  it("requests a full refresh for legacy events and stale cursors", () => {
    const log = new ChangeLog();
    log.append(null);
    expect(log.since(0).reset).toBe(true);
    expect(log.since(50).reset).toBe(true);
  });
});

it.each([false, true])("records removals only when the provider read is complete (%s)", async (complete) => {
  const db = new Database(":memory:");
  try {
    for (const migration of MIGRATIONS) db.exec(migration);
    const changes = new ChangeLog();
    const hub = {
      providers: async () => [{ pluginId: "pages", state: "ready", kinds: [{ id: "page" }] }],
      itemsResult: async () => ({ status: "ready", items: [], complete }),
    } as unknown as Parameters<typeof recordProviderChanges>[0];
    await recordProviderChanges(hub, changes, "pages", ["missing"], ["removed"]);
    expect(changes.since(0).reset).toBe(!complete);
    expect(changes.since(0).changes.filter((change) => change.removed).map((change) => change.id)).toEqual(complete ? ["missing", "removed"] : ["removed"]);
  } finally { db.close(); }
});
