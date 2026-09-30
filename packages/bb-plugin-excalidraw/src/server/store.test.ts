import { describe, expect, it } from "vitest";
import { element, memoryStore, scene } from "../test/db";
import { displayName, toMeta } from "./store";

describe("the drawing store", () => {
  it("creates empty, untitled drawings in a project", () => {
    const { store } = memoryStore(() => 1_000);
    const row = store.create({ name: "", projectId: "proj_a", by: "app" });
    expect(toMeta(row)).toMatchObject({ name: "", projectId: "proj_a", archived: false, elementCount: 0, updatedAt: 1_000 });
    expect(displayName(row)).toBe("Untitled drawing");
  });

  it("gives every write a newer revision, even within one millisecond", () => {
    const { store } = memoryStore(() => 5_000);
    const row = store.create({ name: "Plan", projectId: null, by: "app" });
    const first = store.write(row.id, scene([element("rectangle")]), "editor");
    const second = store.write(row.id, scene([element("rectangle")]), "agent");
    expect(first).toBeGreaterThan(row.updated_at);
    expect(second).toBeGreaterThan(first);
    expect(store.get(row.id)).toMatchObject({ updated_at: second, updated_by: "agent" });
  });

  it("keeps the name unless a write renames it", () => {
    const { store } = memoryStore();
    const row = store.create({ name: "Plan", projectId: null, by: "app" });
    store.write(row.id, scene([]), "editor");
    expect(store.get(row.id)!.name).toBe("Plan");
    store.write(row.id, scene([]), "editor", { name: "Roadmap" });
    expect(store.get(row.id)!.name).toBe("Roadmap");
  });

  it("leaves archived drawings out of the list unless asked", () => {
    const { store } = memoryStore();
    const kept = store.create({ name: "Kept", projectId: null, by: "app" });
    const archived = store.create({ name: "Old", projectId: null, by: "app" });
    store.setArchived(archived.id, true);
    expect(store.list().map((row) => row.id)).toEqual([kept.id]);
    expect(store.list({ includeArchived: true })).toHaveLength(2);
    store.setArchived(archived.id, false);
    expect(store.list()).toHaveLength(2);
  });

  it("moves and deletes drawings", () => {
    const { store } = memoryStore();
    const row = store.create({ name: "", projectId: "proj_a", by: "app" });
    store.setProject(row.id, null);
    expect(store.get(row.id)!.project_id).toBeNull();
    expect(store.delete(row.id)).toBe(true);
    expect(store.delete(row.id)).toBe(false);
    expect(store.get(row.id)).toBeNull();
  });
});

describe("the migrations", () => {
  it("keep the released statements byte for byte", async () => {
    const { createHash } = await import("node:crypto");
    const { MIGRATIONS } = await import("./store");
    // BB refuses to start a plugin whose recorded migrations changed.
    expect(createHash("sha256").update(MIGRATIONS[0]!).digest("hex")).toBe(
      "725e70ae34865747821d93978a139723a029f6f49072061691ead382b52b9d35",
    );
  });
});
