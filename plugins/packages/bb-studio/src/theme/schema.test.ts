import { describe, expect, it } from "vitest";
import { appearanceSchema, defaultAppearance, parseAppearance, withTheme } from "./appearance";
import { BB_DEFAULT, SOLARIZED_LIGHT } from "./builtin/classic";
import { GRID } from "./builtin/grid";
import { resolveLook } from "./look";
import { BUILTIN_THEMES, createThemeRegistry } from "./registry";
import { parseThemePackage, variantFor, type ThemePackage } from "./schema";

const errors = (input: unknown) => {
  const parsed = parseThemePackage(input);
  return parsed.ok ? [] : parsed.errors;
};
const edit = (base: ThemePackage, change: (copy: Record<string, any>) => void) => {
  const copy = structuredClone(base) as Record<string, any>;
  change(copy);
  return copy;
};

describe("a theme package", () => {
  it("parses every built-in theme", () => {
    for (const theme of BUILTIN_THEMES) expect(errors(theme), theme.id).toEqual([]);
  });

  it("keeps a classic theme static and solid, and a scene theme on a shader with glass", () => {
    expect(errors(edit(BB_DEFAULT, (copy) => { copy.scene = GRID.scene; }))).toContain("scene: A classic theme has no scene.");
    expect(errors(edit(BB_DEFAULT, (copy) => { copy.glass = GRID.glass; }))).toContain("glass: A classic theme has solid surfaces.");
    expect(errors(edit(GRID, (copy) => { copy.glass = null; }))).toContain("glass: A scene theme has glass.");
    expect(errors(edit(GRID, (copy) => { copy.scene = { kind: "none" }; }))).toContain("scene: A scene theme has a shader.");
    expect(errors(edit(GRID, (copy) => { copy.defaults.motion = 0; }))).toContain("defaults.motion: A scene theme's motion starts above 0.");
  });

  it("keeps the sidebar's glass lighter than the transcript's and the composer's", () => {
    expect(errors(edit(GRID, (copy) => { copy.glass.sidebar.opacity = 0.95; }))).toContain("glass: The sidebar's glass is lighter than the transcript's and the composer's.");
  });

  it("keeps the main view's open area lighter than the transcript backing, and fills it in for a stored theme written before it existed", () => {
    expect(errors(edit(GRID, (copy) => { copy.glass.main.opacity = 0.9; }))).toContain("glass: The main view's glass is lighter than the transcript's.");
    const stored = parseThemePackage(edit(GRID, (copy) => { delete copy.glass.main; copy.glass.transcript.opacity = 0.8; copy.glass.composer.opacity = 0.9; }));
    expect(stored.ok && stored.theme.glass?.main).toEqual({ opacity: 0.18, blur: 0 });
    const registry = createThemeRegistry([edit(GRID, (copy) => { copy.id = "sea-glass"; delete copy.glass.main; copy.glass.transcript.opacity = 0.8; copy.glass.composer.opacity = 0.9; })]);
    expect(registry.get("sea-glass")?.glass?.main).toEqual({ opacity: 0.18, blur: 0 });
  });

  it("refuses colors, fonts, uniforms and images that could break out of CSS or GLSL", () => {
    expect(errors(edit(GRID, (copy) => { copy.variants.dark.ink = "white"; }))[0]).toMatch(/^variants\.dark\.ink: A color is #rrggbb/);
    expect(errors(edit(GRID, (copy) => { copy.type.body = "Inter; } body { display: none"; }))[0]).toMatch(/^type\.body:/);
    expect(errors(edit(GRID, (copy) => { copy.scene.uniforms = { "gl_FragColor": 1 }; }))[0]).toMatch(/^scene\.uniforms/);
    expect(errors(edit(GRID, (copy) => { copy.scene.fallback.image = "javascript:alert(1)"; }))[0]).toMatch(/^scene\.fallback\.image:/);
    expect(errors(edit(GRID, (copy) => { copy.scene.fallback.image = "data:image/png;base64,iVBORw0KGgo="; }))).toEqual([]);
  });

  it("needs a light or a dark variant, and picks the other one when the app's mode has none", () => {
    expect(errors(edit(GRID, (copy) => { copy.variants = {}; }))).toContain("variants: A theme has a light or a dark variant.");
    expect(variantFor(SOLARIZED_LIGHT, "dark").mode).toBe("light");
    expect(variantFor(BB_DEFAULT, "dark").colors.canvas).toBe("#151515");
    expect(variantFor(BB_DEFAULT, "light").colors.canvas).toBe("#ffffff");
  });
});

describe("a Bot's appearance", () => {
  it("starts from the theme's defaults, with the scene effects only on scene themes", () => {
    expect(defaultAppearance(GRID)).toEqual({ themeId: "grid", intensity: 0.8, glass: 0.6, motion: 0.4, effects: { workers: true, finished: true, needsYou: true, error: true } });
    expect(defaultAppearance(BB_DEFAULT).effects).toEqual({ workers: false, finished: false, needsYou: true, error: false });
  });

  it("keeps its effect switches across a theme change and takes the new theme's sliders", () => {
    const mine = { ...defaultAppearance(GRID), intensity: 0.2, effects: { workers: false, finished: true, needsYou: false, error: true } };
    expect(withTheme(mine, BB_DEFAULT)).toEqual({ ...defaultAppearance(BB_DEFAULT), effects: mine.effects });
  });

  it("reads back a stored appearance, and nothing from a broken one", () => {
    const stored = defaultAppearance(GRID);
    expect(parseAppearance(JSON.stringify(stored))).toEqual(stored);
    expect(parseAppearance("{")).toBeNull();
    expect(parseAppearance(JSON.stringify({ ...stored, intensity: 2 }))).toBeNull();
    expect(appearanceSchema.safeParse({ ...stored, themeId: "Not An Id" }).success).toBe(false);
  });
});

describe("the registry", () => {
  it("lists the scene themes, then the classics, and adds valid stored themes that don't take a built-in id", () => {
    const own = { ...structuredClone(GRID), id: "neon", name: "Neon" };
    const registry = createThemeRegistry([own, { ...own, id: "grid" }, { nonsense: true }]);
    expect(registry.scenes().map((entry) => entry.theme.id)).toEqual(["miami-1985", "event-horizon", "grid", "kyoto-garden", "forest", "aurora-fjord", "tonights-sky", "data-city", "deep-sea", "neon"]);
    expect(registry.classics().map((entry) => entry.theme.name)).toEqual(["bb Default", "One Dark", "Dracula", "Solarized Light", "GitHub Light", "GitHub Dark", "Nord", "Catppuccin Mocha"]);
    expect(registry.get("neon")?.name).toBe("Neon");
    expect(registry.get("grid")).toBe(GRID);
    expect(registry.list().find((entry) => entry.theme.id === "neon")?.source).toBe("stored");
  });

  it("lets a scene declare each variant's own backdrop range, and reads contrast against the shown variant's", () => {
    if (GRID.scene.kind !== "shader") throw new Error("A scene theme has a shader");
    const base = { ...GRID, id: "two-skies", variants: { dark: GRID.variants.dark!, light: { ...GRID.variants.dark!, canvas: "#f6f4ee", ink: "#22201c", sidebar: "#f1eee6" } } };
    const ranged = { ...base, scene: { ...GRID.scene, backdrop: { dark: "#000000", light: "#ffffff", modes: { light: { dark: "#777777", light: "#ffffff" }, dark: { dark: "#000000", light: "#222222" } } } } };
    const parsed = parseThemePackage(ranged);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.theme.scene.kind !== "shader") throw new Error("A scene theme has a shader");
    expect(parsed.theme.scene.backdrop.modes).toEqual({ light: { dark: "#777777", light: "#ffffff" }, dark: { dark: "#000000", light: "#222222" } });
    expect(parseThemePackage({ ...ranged, scene: { ...ranged.scene, backdrop: { ...ranged.scene.backdrop, modes: { light: { dark: "grey", light: "#ffffff" } } } } }).ok).toBe(false);
    const whole = parseThemePackage({ ...base, scene: { ...GRID.scene, backdrop: { dark: "#000000", light: "#ffffff" } } });
    if (!whole.ok) throw new Error(whole.errors.join("; "));
    for (const mode of ["light", "dark"] as const) {
      expect(resolveLook(parsed.theme, GRID.defaults, mode).alpha.transcript, mode).toBeLessThan(resolveLook(whole.theme, GRID.defaults, mode).alpha.transcript);
    }
    expect(resolveLook(parsed.theme, GRID.defaults, "dark").alpha.transcript).toBe(resolveLook({ ...parsed.theme, scene: { ...parsed.theme.scene, backdrop: { dark: "#000000", light: "#222222" } } }, GRID.defaults, "dark").alpha.transcript);
  });
});
