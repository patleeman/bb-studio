import { describe, expect, it, vi } from "vitest";
import { createPreferenceStore, PreferenceValidationError } from "./server.js";

function fakeBb(stored: Record<string, unknown>) {
  const kv = new Map(Object.entries(stored));
  return {
    storage: { kv: { get: async (key: string) => kv.get(key), set: async (key: string, value: unknown) => { kv.set(key, value); }, delete: async (key: string) => { kv.delete(key); } } },
    realtime: { publish: vi.fn() },
    log: { warn: vi.fn() },
    kv,
  };
}

describe("preference store", () => {
  it("reads the earlier sidebar's stored values and reports the Space organization", async () => {
    const bb = fakeBb({ "preference:currentSpace": "spc_1", "preference:hiddenThreads": ["thr_1", "thr_1"], "preference:organizationMode": "project" });
    const values = await createPreferenceStore(bb as never).readAll();
    expect(values).toEqual({ currentSpace: "spc_1", hiddenThreads: ["thr_1"], collapsedThreads: [], collapsedSpaces: [], organizationMode: "space" });
  });

  it("validates, stores and announces a change", async () => {
    const bb = fakeBb({});
    const store = createPreferenceStore(bb as never);
    await expect(store.write("hiddenThreads", "nope")).rejects.toBeInstanceOf(PreferenceValidationError);
    await store.write("currentSpace", "all");
    expect(bb.kv.get("preference:currentSpace")).toBe("all");
    expect(bb.realtime.publish).toHaveBeenCalledWith("preferences", { key: "currentSpace", value: "all" });
  });
});
