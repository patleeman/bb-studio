import { describe, expect, it } from "vitest";
import { BUILTIN_THEMES } from "./registry";
import { optionValue, THEME_OPTIONS, themeOptions } from "./options";
import { builtinOptionStores, readThemeOptions, writeThemeOption } from "./options-contract";
import { readView, VIEW_KEY } from "./tonight/contract";

function fakeKv() {
  const data = new Map<string, unknown>();
  return { data, get: async <T>(key: string) => data.get(key) as T | undefined, set: async (key: string, value: unknown) => { data.set(key, value); }, delete: async (key: string) => { data.delete(key); } };
}

describe("theme options", () => {
  it("are declared for built-in themes only, each with a fallback among its choices and a store behind it", () => {
    const ids = BUILTIN_THEMES.map((theme) => theme.id);
    const stores = builtinOptionStores(fakeKv());
    for (const [themeId, options] of Object.entries(THEME_OPTIONS)) {
      expect(ids).toContain(themeId);
      for (const option of options) {
        expect(option.choices.map((choice) => choice.value)).toContain(option.fallback);
        expect(stores[themeId]?.[option.id], `${themeId}.${option.id}`).toBeDefined();
      }
    }
    expect(themeOptions("tonights-sky").map((option) => [option.id, option.label, option.choices.map((choice) => choice.label)])).toEqual([["view", "View", ["Follow the sun", "South", "East", "West"]]]);
    expect(themeOptions("grid")).toEqual([]);
    expect(themeOptions("constructor")).toEqual([]);
    expect(themeOptions(null)).toEqual([]);
    const view = themeOptions("tonights-sky")[0]!;
    expect(optionValue(view, null)).toBe("follow");
    expect(optionValue(view, { view: "east" })).toBe("east");
    expect(optionValue(view, { view: "up" })).toBe("follow");
  });

  it("reads and writes Tonight's Sky's view through the setting the CLI uses, and refuses what isn't declared", async () => {
    const kv = fakeKv();
    const stores = builtinOptionStores(kv);
    expect(await readThemeOptions(stores, "tonights-sky")).toEqual({ values: { view: "follow" } });
    expect(await writeThemeOption(stores, "tonights-sky", "view", "west")).toEqual({ values: { view: "west" } });
    expect(kv.data.get(VIEW_KEY)).toEqual({ view: "west" });
    expect(await readView(kv)).toBe("west");
    expect(await writeThemeOption(stores, "tonights-sky", "view", "follow")).toEqual({ values: { view: "follow" } });
    expect(kv.data.has(VIEW_KEY)).toBe(false);
    await expect(writeThemeOption(stores, "tonights-sky", "view", "north")).rejects.toThrow("View is one of: follow, south, east, west");
    await expect(writeThemeOption(stores, "tonights-sky", "zoom", "2")).rejects.toThrow("No option zoom on theme tonights-sky");
    await expect(writeThemeOption(stores, "grid", "view", "west")).rejects.toThrow("No option view on theme grid");
    expect(await readThemeOptions(stores, "grid")).toEqual({ values: {} });
  });
});
