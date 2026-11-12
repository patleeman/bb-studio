import { describe, expect, it } from "vitest";
import { importReactionsSettings, REACTIONS_SETTINGS, REACTIONS_SETTINGS_IMPORTED, type ReactionsImportDeps } from "./server";

function fake(options: { installed?: boolean; old?: Record<string, unknown>; mine?: Record<string, unknown> } = {}) {
  const kv = new Map<string, unknown>();
  let mine: Record<string, unknown> = { ...Object.fromEntries(Object.entries(REACTIONS_SETTINGS).map(([key, def]) => [key, def.default])), ...options.mine };
  const deps: ReactionsImportDeps = {
    plugins: {
      list: async () => ({ plugins: options.installed === false ? [] : [{ id: "emoji-react" }] }),
      getSettings: async () => ({ values: options.old ?? {} }),
    },
    kv: { get: async (key) => kv.get(key), set: async (key, value) => { kv.set(key, value); } },
    settings: { get: async () => mine, set: async (values) => { mine = { ...mine, ...values }; } },
  };
  return { deps, kv, mine: () => mine };
}

describe("importReactionsSettings", () => {
  it("copies changed values once, keeping ones the user changed in Studio", async () => {
    const env = fake({ old: { emojiItems: "🔥 Ship", quoteSelection: false, quotePosition: "after", showInUserBar: true }, mine: { quotePosition: "before", quoteSelection: true, showInAssistantBar: false } });
    // Studio's own change: the assistant bar is already off; the old plugin had it on.
    expect(await importReactionsSettings(env.deps)).toEqual(["emojiItems", "quoteSelection", "quotePosition"]);
    expect(env.mine()).toMatchObject({ emojiItems: "🔥 Ship", quoteSelection: false, quotePosition: "after", showInAssistantBar: false });
    expect(env.kv.get(REACTIONS_SETTINGS_IMPORTED)).toBeTruthy();
    expect(await importReactionsSettings({ ...env.deps, plugins: { ...env.deps.plugins, getSettings: async () => ({ values: { emojiItems: "x" } }) } })).toBeNull();
    expect(env.mine().emojiItems).toBe("🔥 Ship");
  });

  it("does not overwrite a value already changed in Studio", async () => {
    const env = fake({ old: { emojiItems: "🔥 Ship" }, mine: { emojiItems: "✅ Mine" } });
    expect(await importReactionsSettings(env.deps)).toEqual([]);
    expect(env.mine().emojiItems).toBe("✅ Mine");
  });

  it("does nothing while the old plugin isn't installed, and ignores invalid values", async () => {
    const absent = fake({ installed: false });
    expect(await importReactionsSettings(absent.deps)).toBeNull();
    expect(absent.kv.size).toBe(0);
    const bad = fake({ old: { quotePosition: "middle", quoteSelection: "no" } });
    expect(await importReactionsSettings(bad.deps)).toEqual([]);
  });
});
