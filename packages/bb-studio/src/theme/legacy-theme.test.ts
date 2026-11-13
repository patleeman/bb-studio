import { describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME_ID, LEGACY_THEME_ID, LEGACY_THEME_KV_KEY, retireLegacyThemeOnce } from "./legacy-theme";

function deps(themeId: string, done = false) {
  const kv = new Map<string, unknown>(done ? [[LEGACY_THEME_KV_KEY, true]] : []);
  return {
    kv: { get: async (key: string) => kv.get(key), set: async (key: string, value: unknown) => { kv.set(key, value); } },
    get: vi.fn(async () => ({ themeId })),
    set: vi.fn(async () => ({})),
  };
}

describe("the old BB Studio palette", () => {
  it("moves a BB appearance still on the teal palette to BB's Default, once", async () => {
    const store = deps(LEGACY_THEME_ID);
    await expect(retireLegacyThemeOnce(store)).resolves.toBe(true);
    expect(store.set).toHaveBeenCalledWith(DEFAULT_THEME_ID);
    await expect(retireLegacyThemeOnce(store)).resolves.toBe(false);
    expect(store.set).toHaveBeenCalledTimes(1);
  });

  it("leaves any other choice alone", async () => {
    const store = deps("nord");
    await expect(retireLegacyThemeOnce(store)).resolves.toBe(false);
    expect(store.set).not.toHaveBeenCalled();
    const later = deps(LEGACY_THEME_ID, true);
    await expect(retireLegacyThemeOnce(later)).resolves.toBe(false);
    expect(later.get).not.toHaveBeenCalled();
  });
});
