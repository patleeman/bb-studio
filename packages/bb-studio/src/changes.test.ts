import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { MIGRATIONS } from "./migrations";
import { StudioServices } from "./services";
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

it.each([false, true])("prunes missing versions only when the provider read is complete (%s)", async (complete) => {
  const db = new Database(":memory:");
  try {
    for (const migration of MIGRATIONS) db.exec(migration);
    const services = new StudioServices(db);
    const changes = new ChangeLog();
    const missing = { pluginId: "pages", id: "missing" };
    const removed = { pluginId: "pages", id: "removed" };
    for (const ref of [missing, removed]) services.addVersion(ref, new Uint8Array([1]), "Before", { kind: "user" });
    const hub = {
      providers: async () => [{ pluginId: "pages", state: "ready", kinds: [{ id: "page" }] }],
      itemsResult: async () => ({ status: "ready", items: [], complete }),
    } as unknown as Parameters<typeof recordProviderChanges>[0];
    await recordProviderChanges(hub, services, changes, "pages", ["missing"], ["removed"]);
    expect(services.versions(missing)).toHaveLength(complete ? 0 : 1);
    expect(services.versions(removed)).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM item_blobs").get()).toEqual({ n: complete ? 0 : 1 });
    expect(changes.since(0).reset).toBe(!complete);
    expect(changes.since(0).changes.filter((change) => change.removed).map((change) => change.id)).toEqual(complete ? ["missing", "removed"] : ["removed"]);
  } finally { db.close(); }
});
