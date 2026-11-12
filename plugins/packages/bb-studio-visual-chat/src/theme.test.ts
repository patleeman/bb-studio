import { describe, expect, it } from "vitest";
import { lookPalette, MARK_CONTRAST, ORGANIC_LOOKS, TEXT_CONTRAST, tokenDeclarations } from "./looks";
import { bbTheme, contrast, defaultBbTheme, parseColor, rgb, rgbToOklch, toHex, type BbTheme } from "./theme";

// BB's built-in palettes (apps/app/src/lib/themes in BB), as the page resolves them.
const NORD_DARK = bbTheme("dark", { colors: { background: "#2e3440", foreground: "#d8dee9", card: "#2e3440", popover: "#2e3440", primary: "#88c0d0", mutedForeground: "rgb(176 183 196)", border: "color(srgb 0.26 0.29 0.35)", destructive: "#bf616a", success: "#a3be8c", warning: "#d08770" }, fonts: { sans: `"Inter Variable", Inter, sans-serif` }, radius: 8 });
const NORD_LIGHT = bbTheme("light", { colors: { background: "#eceff4", foreground: "#2e3440", card: "#eceff4", primary: "#5e81ac", mutedForeground: "#5c6373", border: "#d3d7de", destructive: "#bf616a", success: "#6f9655", warning: "#d08770" } });
const DRACULA_DARK = bbTheme("dark", { colors: { background: "#282a36", foreground: "#f8f8f2", card: "#282a36", primary: "#bd93f9", mutedForeground: "#a9abb5", border: "#44475a" } });
const THEMES: Record<string, BbTheme> = { "default light": defaultBbTheme("light"), "default dark": defaultBbTheme("dark"), "nord dark": NORD_DARK, "nord light": NORD_LIGHT, "dracula dark": DRACULA_DARK };

describe("colors", () => {
  it("reads the color forms the page resolves to", () => {
    expect(toHex(parseColor("#2e3440")!)).toBe("#2e3440");
    expect(toHex(parseColor("#fff")!)).toBe("#ffffff");
    expect(toHex(parseColor("rgb(46, 52, 64)")!)).toBe("#2e3440");
    expect(toHex(parseColor("rgb(46 52 64 / 0.5)")!)).toBe("#2e3440");
    expect(toHex(parseColor("color(srgb 1 0 0)")!)).toBe("#ff0000");
    expect(toHex(parseColor("oklch(1 0 0)")!)).toBe("#ffffff");
    expect(toHex(parseColor("oklch(0 0 0)")!)).toBe("#000000");
    // BB's default dark ground.
    expect(toHex(parseColor("oklch(0.195 0 0)")!)).toBe("#151515");
    expect(parseColor("color-mix(in oklch, red, blue)")).toBeNull();
    expect(parseColor("nonsense")).toBeNull();
  });

  it("measures WCAG contrast", () => {
    expect(contrast(rgb("#ffffff"), rgb("#000000"))).toBeCloseTo(21, 5);
    expect(contrast(rgb("#777777"), rgb("#777777"))).toBeCloseTo(1, 5);
  });

  it("falls back to BB's default for anything missing or unreadable", () => {
    const theme = bbTheme("dark", { colors: { background: "#2e3440", foreground: "not a color" }, radius: Number.NaN });
    expect(theme.colors.background).toBe("#2e3440");
    expect(theme.colors.foreground).toBe(defaultBbTheme("dark").colors.foreground);
    expect(theme.radius).toBe(8);
    expect(theme.fonts.sans).toContain("Inter");
  });
});

describe("a style on BB's theme", () => {
  for (const [name, theme] of Object.entries(THEMES)) {
    for (const look of ORGANIC_LOOKS) {
      it(`takes BB's ground, card, ink and rules, and reads in ${name} (${look})`, () => {
        const palette = lookPalette(look, theme);
        const c = theme.colors;
        // The base is BB's: no style brings its own background.
        expect(palette.paper).toBe(c.background);
        expect(palette.surface).toBe(c.card);
        expect(palette.ink).toBe(c.foreground);
        expect(palette.rule).toBe(c.border);
        const ground = rgb(palette.paper!);
        const reads = (token: string, min: number) => expect(contrast(rgb(palette[token]!), ground), `${token} ${palette[token]} on ${palette.paper}`).toBeGreaterThanOrEqual(min - 0.01);
        // Text tokens read as text; chart and hue marks as marks.
        for (const token of ["ink", "ink-2", "muted", "accent", "good", "bad", "warn"]) reads(token, TEXT_CONTRAST);
        for (const token of ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "blue", "red", "green", "amber", "purple", "teal", "gray"]) reads(token, MARK_CONTRAST);
        // Text on the accent reads too.
        expect(contrast(rgb(palette["accent-ink"]!), rgb(palette.accent!))).toBeGreaterThanOrEqual(3);
        // The highlighter keeps ink legible on it.
        expect(contrast(rgb(palette.ink!), rgb(palette.highlight!))).toBeGreaterThanOrEqual(TEXT_CONTRAST);
        // Six distinct chart hues before the neutrals.
        const series = ["c1", "c2", "c3", "c4", "c5", "c6"].map((token) => rgbToOklch(rgb(palette[token]!)).h);
        for (let i = 0; i < series.length; i++) for (let j = i + 1; j < series.length; j++) {
          const gap = Math.abs(series[i]! - series[j]!) % 360;
          expect(Math.min(gap, 360 - gap), `c${i + 1} and c${j + 1}`).toBeGreaterThan(20);
        }
      });
    }
  }

  it("leads charts with BB's accent when it has a color, else with the style's", () => {
    const nord = lookPalette("editorial", NORD_DARK);
    expect(Math.abs(rgbToOklch(rgb(nord.c1!)).h - rgbToOklch(rgb("#88c0d0")).h)).toBeLessThan(3);
    // BB's default primary is a gray: the style's accent hue leads instead.
    const plain = lookPalette("editorial", defaultBbTheme("light"));
    expect(Math.abs(rgbToOklch(rgb(plain.c1!)).h - rgbToOklch(rgb(plain.accent!)).h)).toBeLessThan(3);
  });

  it("gives each style its own accent over the same ground", () => {
    const accents = ORGANIC_LOOKS.map((look) => lookPalette(look, NORD_DARK).accent);
    expect(new Set(accents).size).toBe(3);
    expect(new Set(ORGANIC_LOOKS.map((look) => lookPalette(look, NORD_DARK).paper))).toEqual(new Set(["#2e3440"]));
  });

  it("writes the tokens with BB's fonts and radius under the style's type", () => {
    const css = tokenDeclarations("editorial", NORD_DARK);
    expect(css).toContain("--cv-paper:#2e3440");
    expect(css).toContain("--cv-ink:#d8dee9");
    // Body text is BB's sans; the editorial display face stays a serif.
    expect(css).toMatch(/--cv-font-text:"Inter Variable"/);
    expect(css).toMatch(/--cv-font-display:"Iowan Old Style"/);
    expect(tokenDeclarations("instrument", NORD_DARK)).toMatch(/--cv-font-label:ui-monospace/);
    // Field takes BB's radius; editorial and instrument keep theirs, never above BB's.
    expect(tokenDeclarations("field", NORD_DARK)).toContain("--cv-radius:8px");
    expect(tokenDeclarations("editorial", bbTheme("light", { radius: 0 }))).toContain("--cv-radius:0px");
  });
});
