import { describe, expect, it } from "vitest";
import { defaultAppearance, missingThemeNote, parseAppearance, resolveTheme } from "./appearance";
import { AURORA_FJORD } from "./builtin/aurora-fjord";
import { KYOTO_GARDEN } from "./builtin/kyoto-garden";
import { GRID } from "./builtin/grid";
import { canonicalThemeId, createThemeRegistry, DEFAULT_THEME_ID, isBuiltinTheme } from "./registry";

describe("theme ids that were renamed", () => {
  it("resolves cabin-aurora to Aurora Fjord, and leaves other ids alone", () => {
    const registry = createThemeRegistry();
    expect(registry.get("cabin-aurora")).toBe(AURORA_FJORD);
    expect(registry.get("aurora-fjord")).toBe(AURORA_FJORD);
    expect(registry.list().map((entry) => entry.theme.id)).not.toContain("cabin-aurora");
    expect(canonicalThemeId("cabin-aurora")).toBe("aurora-fjord");
    expect(canonicalThemeId("grid")).toBe("grid");
    expect(registry.get("no-such-theme")).toBeNull();
  });

  it("reads a Bot's stored cabin-aurora appearance as aurora-fjord with its own settings kept", () => {
    const stored = JSON.stringify({ themeId: "cabin-aurora", intensity: 0.55, glass: 0.3, motion: 0.2, effects: { workers: true, finished: false, needsYou: true, error: true } });
    expect(parseAppearance(stored)).toEqual({ themeId: "aurora-fjord", intensity: 0.55, glass: 0.3, motion: 0.2, effects: { workers: true, finished: false, needsYou: true, error: true } });
    expect(parseAppearance(JSON.stringify({ themeId: "forest", intensity: 0.8, glass: 0.6, motion: 0.4, effects: { workers: true, finished: true, needsYou: true, error: true } }))!.themeId).toBe("forest");
  });

  it("resolves zen-garden to Kyoto Garden, in the registry and in a Bot's stored appearance", () => {
    const registry = createThemeRegistry([{ ...KYOTO_GARDEN, id: "zen-garden", name: "Impostor" }]);
    expect(registry.get("zen-garden")).toBe(KYOTO_GARDEN);
    expect(registry.get("kyoto-garden")).toBe(KYOTO_GARDEN);
    expect(canonicalThemeId("zen-garden")).toBe("kyoto-garden");
    expect(isBuiltinTheme("zen-garden")).toBe(true);
    expect(registry.list().map((entry) => entry.theme.id)).not.toContain("zen-garden");
    expect(registry.list().map((entry) => entry.theme.name)).not.toContain("Impostor");
    const stored = JSON.stringify({ themeId: "zen-garden", intensity: 0.6, glass: 0.5, motion: 0.3, effects: { workers: false, finished: true, needsYou: true, error: false } });
    expect(parseAppearance(stored)).toEqual({ themeId: "kyoto-garden", intensity: 0.6, glass: 0.5, motion: 0.3, effects: { workers: false, finished: true, needsYou: true, error: false } });
  });

  it("keeps the old id reserved, so a stored theme can't take it", () => {
    expect(isBuiltinTheme("cabin-aurora")).toBe(true);
    const registry = createThemeRegistry([{ ...AURORA_FJORD, id: "cabin-aurora", name: "Impostor" }]);
    expect(registry.get("cabin-aurora")).toBe(AURORA_FJORD);
    expect(registry.list().map((entry) => entry.theme.name)).not.toContain("Impostor");
  });
});

describe("a Bot's saved theme that is gone", () => {
  const custom = { ...structuredClone(GRID), id: "after-dark", name: "After Dark" };
  const saved = { ...defaultAppearance(custom), intensity: 0.31, effects: { workers: false, finished: true, needsYou: false, error: true } };

  it("FM: shows the default theme and names the missing id when a saved custom theme is deleted", () => {
    const resolved = resolveTheme(createThemeRegistry(), saved);
    expect(resolved.missing).toBe("after-dark");
    expect(resolved.theme?.id).toBe(DEFAULT_THEME_ID);
    expect(resolved.appearance?.themeId).toBe(DEFAULT_THEME_ID);
    expect(resolved.appearance?.effects).toEqual(saved.effects);
    expect(missingThemeNote("after-dark")).toBe('The theme "after-dark" is gone; showing the default. Pick another.');
  });

  it("FM: keeps a saved theme that is still there, and shows nothing for no theme", () => {
    const resolved = resolveTheme(createThemeRegistry([custom]), saved);
    expect(resolved).toEqual({ theme: expect.objectContaining({ id: "after-dark" }), appearance: saved, missing: null });
    expect(resolveTheme(createThemeRegistry(), null)).toEqual({ theme: null, appearance: null, missing: null });
  });

  it("FM: does not call a custom theme gone while the stored themes are still loading", () => {
    expect(resolveTheme(createThemeRegistry([], { ready: false }), saved)).toEqual({ theme: null, appearance: null, missing: null });
    expect(resolveTheme(createThemeRegistry([], { ready: false }), defaultAppearance(GRID)).theme?.id).toBe("grid");
  });
});
