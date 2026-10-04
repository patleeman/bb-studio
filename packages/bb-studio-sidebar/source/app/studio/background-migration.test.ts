import { describe, expect, it } from "vitest";
import { migrateBackgroundPreference } from "./background-migration.js";
import { parsePreferenceValue } from "../../shared/preferences.js";

function memoryKv(initial: Record<string, unknown>) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async get<T>(key: string) { return data.get(key) as T | undefined; },
    async set(key: string, value: unknown) { data.set(key, value); },
    async delete(key: string) { data.delete(key); },
  };
}

describe("Background preference migration", () => {
  it.each([
    ["hidden", { "*": "hidden" }],
    ["all", { "*": "all" }],
    ["grouped", undefined],
    ["updates", undefined],
  ] as const)("carries %s over and drops the old keys", async (old, expected) => {
    const kv = memoryKv({ "preference:backgroundThreads": old, "preference:backgroundCollapsed": true });
    await migrateBackgroundPreference(kv);
    expect(kv.data.get("preference:automatedThreads")).toEqual(expected);
    expect(kv.data.has("preference:backgroundThreads")).toBe(false);
    expect(kv.data.has("preference:backgroundCollapsed")).toBe(false);
    if (expected) expect(parsePreferenceValue("automatedThreads", expected).success).toBe(true);
  });

  it("keeps a choice made in the new menus", async () => {
    const kv = memoryKv({ "preference:backgroundThreads": "hidden", "preference:automatedThreads": { "*": "all", threads: "hidden" } });
    expect(await migrateBackgroundPreference(kv)).toBeNull();
    expect(kv.data.get("preference:automatedThreads")).toEqual({ "*": "all", threads: "hidden" });
    expect(kv.data.has("preference:backgroundThreads")).toBe(false);
  });

  it("does nothing without old preferences", async () => {
    const kv = memoryKv({ "preference:automatedThreads": { threads: "all" } });
    expect(await migrateBackgroundPreference(kv)).toBeNull();
    expect([...kv.data.keys()]).toEqual(["preference:automatedThreads"]);
  });

  it("ignores the old keys once they are gone from the schema", () => {
    expect(parsePreferenceValue("organizationMode", "space").success).toBe(true);
    expect(parsePreferenceValue("hiddenGroups", ["space:sp_a"]).success).toBe(true);
  });
});
