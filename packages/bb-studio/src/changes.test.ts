import { describe, expect, it } from "vitest";
import { ChangeLog } from "./changes";

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
