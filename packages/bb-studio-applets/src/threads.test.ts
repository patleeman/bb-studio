import { describe, expect, it } from "vitest";
import { sortForHud, summarize } from "./threads";

describe("threads", () => {
  it("puts threads that need you first, then active, then recent", () => {
    const rows = [
      summarize({ id: "a", title: "idle", status: "idle", updatedAt: 3 }),
      summarize({ id: "b", title: "running", status: "active", updatedAt: 1 }),
      summarize({ id: "c", title: " ", status: "idle", updatedAt: 2, hasPendingInteraction: true }),
      summarize({ id: "d", title: "failed", status: "error", updatedAt: 0 }),
    ];
    expect(sortForHud(rows).map((row) => row.id)).toEqual(["c", "d", "b", "a"]);
    expect(rows[2]?.title).toBe("Untitled thread");
  });
});
