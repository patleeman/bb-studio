// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ThemeEngine, type EngineDeps } from "./engine";
import { defaultAppearance } from "./appearance";
import { BB_DEFAULT } from "./builtin/classic";
import { MIAMI } from "./builtin/miami";
import { KYOTO_GARDEN } from "./builtin/kyoto-garden";
import { BUNDLED_FONTS, bundledFontsFor, FONT_STYLE_ID, fontFaceCss, loadBundledFonts, stackFamilies } from "./fonts";
import { FONT_DATA } from "./fonts/data";
import { resolveLook } from "./look";
import { BUILTIN_THEMES, SCENE_THEMES } from "./registry";
import { parseThemePackage, themeModes } from "./schema";
import { THEME_TEMPLATE } from "./template";
import { HEADING_WEIGHT_ATTRIBUTE, HEADINGS, lookTokens, THEME_CSS } from "./tokens";

const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), "fonts");
const GENERIC = new Set(["serif", "sans-serif", "monospace", "system-ui", "ui-monospace", "-apple-system"]);
const VERIFIED_FIRST = new Set(["Jost", "Avenir Next", "DIN Alternate", "Iowan Old Style", "Optima", "Gill Sans", "Inter Variable", "-apple-system", "ui-monospace"]);

describe("the bundled fonts", () => {
  it("are woff2 files on disk, each with its license text beside it, and the embedded data is those files", () => {
    const onDisk = readdirSync(FONT_DIR).filter((name) => name.endsWith(".woff2")).sort();
    expect(BUNDLED_FONTS.map((font) => font.file).sort()).toEqual(onDisk);
    expect(Object.keys(FONT_DATA).sort()).toEqual(onDisk);
    for (const font of BUNDLED_FONTS) {
      const bytes = readFileSync(join(FONT_DIR, font.file));
      expect(bytes.subarray(0, 4).toString("latin1")).toBe("wOF2");
      expect(FONT_DATA[font.file]).toBe(bytes.toString("base64"));
      expect(readFileSync(join(FONT_DIR, font.licenseFile), "utf8")).toContain("SIL OPEN FONT LICENSE Version 1.1");
      expect(readFileSync(join(FONT_DIR, font.licenseFile), "utf8")).toContain(font.copyright);
    }
    expect(onDisk.reduce((total, name) => total + readFileSync(join(FONT_DIR, name)).length, 0)).toBeLessThan(400_000);
  });

  it("writes @font-face rules that load only the embedded files, never a URL", () => {
    const css = fontFaceCss(BUNDLED_FONTS);
    const sources = [...css.matchAll(/url\(([^)]*)\)/g)].map((match) => match[1]!);
    expect(sources).toEqual(BUNDLED_FONTS.map((font) => `data:font/woff2;base64,${FONT_DATA[font.file]}`));
    expect(css.replace(/url\([^)]*\)/g, "")).not.toMatch(/https?:|\/\/|@import/);
    expect(css.match(/font-display: swap;/g)).toHaveLength(BUNDLED_FONTS.length);
    expect(() => fontFaceCss([{ ...BUNDLED_FONTS[0]!, file: "Missing.woff2" }])).toThrow("Missing.woff2");
  });

  it("are picked by the families a theme's stacks name, quoted or not", () => {
    expect(stackFamilies(`Jost, "Avenir Next", 'Trebuchet MS', sans-serif`)).toEqual(["Jost", "Avenir Next", "Trebuchet MS", "sans-serif"]);
    expect(bundledFontsFor([MIAMI.type.heading, MIAMI.type.body]).map((font) => font.family)).toEqual(["Jost"]);
    expect(bundledFontsFor([`"Jost", serif`]).map((font) => font.family)).toEqual(["Jost"]);
    expect(bundledFontsFor([BB_DEFAULT.type.heading, BB_DEFAULT.type.body, BB_DEFAULT.type.mono, undefined])).toEqual([]);
    expect(bundledFontsFor(["Jostle, sans-serif"])).toEqual([]);
  });

  it("load once, and only when a stack names them", () => {
    const doc = document.implementation.createHTMLDocument("fonts");
    loadBundledFonts(doc, [KYOTO_GARDEN.type.heading, KYOTO_GARDEN.type.body]);
    expect(doc.getElementById(FONT_STYLE_ID)).toBeNull();
    loadBundledFonts(doc, [MIAMI.type.heading]);
    loadBundledFonts(doc, [MIAMI.type.heading]);
    expect(doc.querySelectorAll(`#${FONT_STYLE_ID}`)).toHaveLength(1);
    expect(doc.getElementById(FONT_STYLE_ID)!.textContent!.match(/@font-face/g)).toHaveLength(1);
  });
});

describe("every theme's font stacks", () => {
  it("start with a bundled face or one verified on macOS, and end with a generic family", () => {
    const bundled = new Set(BUNDLED_FONTS.map((font) => font.family));
    for (const theme of [...BUILTIN_THEMES, THEME_TEMPLATE]) {
      for (const stack of [theme.type.heading, theme.type.body, theme.type.mono, theme.type.transcript]) {
        if (!stack) continue;
        const families = stackFamilies(stack);
        expect(bundled.has(families[0]!) || VERIFIED_FIRST.has(families[0]!), `${theme.id}: ${families[0]}`).toBe(true);
        expect(GENERIC.has(families.at(-1)!), `${theme.id}: ${stack}`).toBe(true);
      }
    }
  });

  it("give each scene theme the mockup's heading weight, and leave the classics' headings alone", () => {
    expect(Object.fromEntries(SCENE_THEMES.map((theme) => [theme.id, theme.type.headingWeight]))).toEqual({ "miami-1985": 500, "event-horizon": 600, grid: 700, "kyoto-garden": 600, forest: 600, "aurora-fjord": 700, "tonights-sky": 600, "data-city": 600, "deep-sea": 500 });
    for (const theme of BUILTIN_THEMES) if (theme.kind === "classic") expect(theme.type.headingWeight, theme.id).toBeUndefined();
  });
});

describe("a theme's heading weight", () => {
  const withWeight = (value: unknown) => {
    const copy = structuredClone(MIAMI) as Record<string, any>;
    copy.type.headingWeight = value;
    const parsed = parseThemePackage(copy);
    return parsed.ok ? [] : parsed.errors;
  };

  it("is a whole hundred from 100 to 900, or left out", () => {
    for (const weight of [100, 500, 900]) expect(withWeight(weight), String(weight)).toEqual([]);
    for (const weight of [0, 50, 450, 1000, 500.5, "500", "500; } body { display: none", null]) expect(withWeight(weight)[0], String(weight)).toMatch(/^type\.headingWeight:/);
    const copy = structuredClone(MIAMI) as Record<string, any>;
    delete copy.type.headingWeight;
    expect(parseThemePackage(copy).ok).toBe(true);
  });

  it("becomes a token only when the theme sets one", () => {
    expect(lookTokens(resolveLook(MIAMI, MIAMI.defaults, "dark"))["--studio-font-heading-weight"]).toBe("500");
    expect("--studio-font-heading-weight" in lookTokens(resolveLook(BB_DEFAULT, BB_DEFAULT.defaults, "dark"))).toBe(false);
  });

  it("is applied to headings outside a transcript, under its own attribute so a theme without one keeps each heading's weight", () => {
    expect(HEADINGS).toBe(":where(h1, h2, h3, [data-studio-heading]):not([data-thread-window] *)");
    expect(THEME_CSS).toContain(`html[data-studio-theme] ${HEADINGS} { font-family: var(--studio-font-heading); }`);
    expect(THEME_CSS).toContain(`html[${HEADING_WEIGHT_ATTRIBUTE}] ${HEADINGS} { font-weight: var(--studio-font-heading-weight); }`);
    expect(THEME_CSS.match(/font-weight/g)).toHaveLength(1);
  });

  it("is set on the root with the theme's fonts loaded, and taken off for a theme without one", () => {
    const doc = document.implementation.createHTMLDocument("engine");
    const host = doc.createElement("div");
    doc.body.appendChild(host);
    const deps: EngineDeps = { root: doc.documentElement, host, createContext: () => null, requestFrame: () => 1, cancelFrame: () => {}, now: () => 0, size: () => ({ width: 800, height: 600 }), scenes: false };
    const engine = new ThemeEngine(deps);
    engine.show({ key: "a:miami", theme: MIAMI, appearance: defaultAppearance(MIAMI) }, themeModes(MIAMI)[0]!);
    expect(doc.documentElement.getAttribute(HEADING_WEIGHT_ATTRIBUTE)).toBe("500");
    expect(doc.documentElement.style.getPropertyValue("--studio-font-heading-weight")).toBe("500");
    expect(doc.getElementById(FONT_STYLE_ID)!.textContent).toContain(`font-family: "Jost"`);
    engine.show(null, "dark");
    expect(doc.documentElement.hasAttribute(HEADING_WEIGHT_ATTRIBUTE)).toBe(false);
    engine.show({ key: "a:classic", theme: BB_DEFAULT, appearance: defaultAppearance(BB_DEFAULT) }, "dark");
    engine.dispose();
    expect(doc.documentElement.hasAttribute(HEADING_WEIGHT_ATTRIBUTE)).toBe(false);
  });
});
