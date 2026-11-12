import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrast, hexToRgb, luminance, mixOklch, over, rgbToHex } from "./color";
import { CLASSIC_THEMES } from "./builtin/classic";
import { GRID } from "./builtin/grid";
import { contrastChecks } from "./checks";
import { MIAMI } from "./builtin/miami";
import { SCENE_THEMES } from "./registry";
import { chosenAlpha, contrastReport, haloCoverage, HALO, HALO_LAYERS, mixLooks, openAreaMeasure, resolveLook, surfaceBackgrounds, backdropRange, TEXT_MIN, UI_MIN } from "./look";
import { HEADER_CSS, CHROME_CSS, GUTTER_CSS, TABLE_CSS, BACKING_SELECTORS, PAGE_ROOTS, HALO_SELECTORS, lookTokens, PILL_SELECTOR, SCROLLER_SELECTORS, WORKBENCH, WORKBENCH_BODY, WORKBENCH_STRIP, SHADOW_CLIP_SELECTORS, THEME_CSS, HEADER_ROW, LIST_PAGE, RULES, RULE_CLASSES, TITLE_BOX, PAGE_BAR_BOX, PROMPT_CARDS, PROMPT_CARD_LINES, TOAST_CARD, GLASS_CHIPS, CLASSIC_FOOTER, STUDIO_RULE, GLASS_DIFF_CARD, diffBody } from "./tokens";
import { themeModes } from "./schema";

const here = dirname(fileURLToPath(import.meta.url));

const defaults = (theme: typeof GRID) => ({ intensity: theme.defaults.intensity, glass: theme.defaults.glass, motion: theme.defaults.motion });

describe("color math", () => {
  it("matches the WCAG contrast of known pairs", () => {
    expect(contrast(hexToRgb("#000000"), hexToRgb("#ffffff"))).toBeCloseTo(21, 5);
    expect(contrast(hexToRgb("#777777"), hexToRgb("#ffffff"))).toBeCloseTo(4.48, 2);
  });

  it("mixes in oklch like CSS color-mix, ends included", () => {
    const ink = hexToRgb("#e4fbff"), canvas = hexToRgb("#010609");
    expect(rgbToHex(mixOklch(ink, canvas, 1))).toBe("#e4fbff");
    expect(rgbToHex(mixOklch(ink, canvas, 0))).toBe("#010609");
    expect(rgbToHex(over(hexToRgb("#ffffff"), 0.5, hexToRgb("#000000")))).toBe("#808080");
  });
});

describe("contrast on every surface", () => {
  it("passes for every classic theme, on every surface, in each of its modes", () => {
    for (const theme of CLASSIC_THEMES) {
      const lines = contrastChecks(theme);
      expect(lines.length, theme.id).toBe(themeModes(theme).length * 5);
      for (const line of lines) expect(line.pass, `${theme.id} ${line.reason}`).toBe(true);
    }
  });

  it("raises the glass at run time until text reads, even with the slider at 0 and a bright scene at full intensity", () => {
    const bright = structuredClone(GRID);
    if (bright.scene.kind === "shader") bright.scene.backdrop.light = "#9fe8f0";
    const look = resolveLook(bright, { intensity: 1, glass: 0, motion: 0.4 }, "dark");
    expect(chosenAlpha(bright, "sidebar", 0)).toBe(0);
    expect(look.alpha.sidebar).toBeGreaterThan(0.3);
    for (const line of contrastReport(bright, look)) expect(line.pass, `${line.surface} ${line.role} ${line.ratio}`).toBe(true);
    expect(resolveLook(bright, { intensity: 0, glass: 0, motion: 0.4 }, "dark").alpha.sidebar).toBeLessThan(look.alpha.sidebar);
  });

  it("keeps the theme's own glass where it already reads: the sidebar lighter than the transcript and the composer", () => {
    const look = resolveLook(GRID, { ...defaults(GRID), intensity: 0.7 }, "dark");
    expect(look.alpha.sidebar).toBe(0.14);
    expect(look.alpha.transcript).toBe(0.16);
    expect(look.alpha.composer).toBe(0.42);
    expect(look.alpha.sidebar).toBeLessThan(look.alpha.transcript);
  });

  it("keeps the cards clear with a little blur so the scene reads through them, keeps the composer densest, and leaves the gutters to the scene", () => {
    for (const theme of SCENE_THEMES) {
      const mode = themeModes(theme)[0]!;
      const look = resolveLook(theme, defaults(theme), mode);
      expect(look.alpha.main, theme.id).toBe(theme.glass!.main.opacity);
      expect(look.alpha.main, theme.id).toBeLessThanOrEqual(0.05);
      expect(look.blur.main, theme.id).toBe(0);
      expect(look.alpha.transcript, theme.id).toBeGreaterThanOrEqual(0.12);
      if (theme.glass!.modes?.[mode]) {
        expect(look.alpha.transcript, theme.id).toBeGreaterThanOrEqual(0.55);
        expect(look.alpha.composer, theme.id).toBeGreaterThan(Math.max(look.alpha.transcript, look.alpha.sidebar));
        expect(look.blur.transcript, theme.id).toBeGreaterThanOrEqual(12);
        continue;
      }
      expect(look.alpha.transcript, theme.id).toBeLessThanOrEqual(0.3);
      expect(look.alpha.sidebar, theme.id).toBeLessThanOrEqual(0.3);
      expect(look.alpha.composer, theme.id).toBeGreaterThan(Math.max(look.alpha.transcript, look.alpha.sidebar) + 0.2);
      expect(look.blur.transcript, theme.id).toBeGreaterThanOrEqual(4);
      expect(look.blur.transcript, theme.id).toBeLessThanOrEqual(8);
      const open = openAreaMeasure(theme, look);
      expect(open.alpha, theme.id).toBe(look.alpha.main);
      expect(open.text, theme.id).toBeGreaterThan(1);
      const bare = resolveLook(theme, { ...defaults(theme), intensity: 1, glass: 0 }, mode);
      expect(bare.alpha.main, theme.id).toBe(0);
      for (const line of contrastReport(theme, bare)) {
        expect(line.surface, theme.id).not.toBe("main");
        expect(line.pass, `${theme.id} ${line.surface} ${line.role} ${line.ratio}`).toBe(true);
      }
    }
  });

  it("measures muted text on Miami's open gutters against its brightest backdrop: not readable there, so it never sits there", () => {
    const look = resolveLook(MIAMI, defaults(MIAMI), "dark");
    const open = openAreaMeasure(MIAMI, look);
    expect(open.alpha).toBe(0.03);
    expect(open.mutedText).toBeLessThan(TEXT_MIN);
    expect(contrastReport(MIAMI, look).filter((line) => line.surface === "transcript" && line.role === "muted text")[0]!.ratio).toBeGreaterThanOrEqual(TEXT_MIN);
    expect(contrastChecks(MIAMI).find((line) => line.id === "contrast:dark:main")).toMatchObject({ pass: true, reason: expect.stringMatching(/^dark main: open area at 3% tint, text [\d.]+ and muted text [\d.]+ over the brightest backdrop; text sits on the cards$/) });
  });

  it("scales the backing and the open area together with the glass slider, and the slider at 0 clears the open area", () => {
    const half = resolveLook(GRID, { ...defaults(GRID), glass: GRID.defaults.glass / 2 }, "dark");
    expect(half.alpha.main).toBeCloseTo(0.015, 5);
    expect(half.alpha.transcript).toBeGreaterThanOrEqual(0.08);
    const full = resolveLook(GRID, { ...defaults(GRID), glass: 1 }, "dark");
    expect(full.alpha.main).toBeCloseTo(0.05, 5);
    expect(full.alpha.transcript).toBeCloseTo(0.16 / 0.6, 5);
    expect(resolveLook(GRID, { ...defaults(GRID), glass: 0 }, "dark").alpha.main).toBe(0);
  });

  it("measures the HUD over any wallpaper, black to white", () => {
    const look = resolveLook(GRID, defaults(GRID), "dark");
    const backgrounds = surfaceBackgrounds(hexToRgb("#010609"), look.alpha.hud, backdropRange(GRID, "hud", 1));
    expect(backgrounds.map(rgbToHex)).toHaveLength(2);
    for (const background of backgrounds) expect(contrast(look.ink, background)).toBeGreaterThanOrEqual(TEXT_MIN);
  });

  it("makes muted text darker or lighter, never unreadable, when a theme's text is close to its ground", () => {
    const pale = structuredClone(CLASSIC_THEMES[0]!);
    pale.variants.light!.ink = "#666666";
    const look = resolveLook(pale, defaults(pale), "light");
    expect(look.shares.muted).toBeGreaterThan(0.72);
    expect(contrastReport(pale, look).filter((line) => line.role === "muted text").every((line) => line.pass)).toBe(true);
  });

  it("fails a theme whose text can't read on its own canvas", () => {
    const murky = structuredClone(CLASSIC_THEMES[1]!);
    murky.variants.dark!.ink = "#3a3f4b";
    const failed = contrastChecks(murky).filter((line) => !line.pass);
    expect(failed.map((line) => line.id)).toContain("contrast:dark:transcript");
    expect(failed[0]!.reason).toMatch(/text \d/);
  });
});

describe("the text halo", () => {
  it("counts only what reaches the edge of a thin stroke: a tight shadow covers most, a wide soft one little", () => {
    expect(haloCoverage([])).toBe(0);
    expect(haloCoverage([{ blur: 0, alpha: 0.8 }])).toBeCloseTo(0.8, 5);
    expect(haloCoverage([{ blur: 2, alpha: 1 }], 1)).toBeCloseTo(0.341, 2);
    expect(haloCoverage([{ blur: 16, alpha: 1 }], 1)).toBeCloseTo(0.05, 2);
    expect(haloCoverage([{ blur: 2, alpha: 1 }], 3)).toBeGreaterThan(haloCoverage([{ blur: 2, alpha: 1 }], 1));
    expect(HALO).toBeGreaterThan(0.5);
    expect(HALO).toBeLessThan(0.6);
  });

  it("measures text on the sidebar and transcript cards with the halo over the card over the brightest backdrop, and still needs 3:1 without it, 4.5:1 for dark text on a light variant", () => {
    for (const theme of SCENE_THEMES) {
      const mode = themeModes(theme)[0]!;
      const lines = contrastReport(theme, resolveLook(theme, defaults(theme), mode));
      expect(lines.filter((line) => line.role === "text without its halo").map((line) => line.surface), theme.id).toEqual(["sidebar", "transcript"]);
      for (const line of lines) expect(line.pass, `${theme.id} ${line.surface} ${line.role} ${line.ratio}`).toBe(true);
      for (const line of lines.filter((each) => each.role === "text without its halo")) expect(line.min, theme.id).toBe(mode === "light" ? TEXT_MIN : UI_MIN);
    }
    const look = resolveLook(MIAMI, defaults(MIAMI), "dark");
    const backdrop = backdropRange(MIAMI, "transcript", 1);
    const card = surfaceBackgrounds(look.canvas, look.alpha.transcript, backdrop);
    const haloed = surfaceBackgrounds(look.canvas, look.alpha.transcript, backdrop, HALO, look.canvas);
    expect(Math.min(...haloed.map((each) => contrast(look.ink, each)))).toBeGreaterThan(Math.min(...card.map((each) => contrast(look.ink, each))));
    expect(rgbToHex(haloed[1]!)).toBe(rgbToHex(over(look.canvas, HALO, card[1]!)));
  });
});

describe("the tokens", () => {
  it("anchor on --canvas and --ink, mix opaque steps in oklch and translucent ones in oklab", () => {
    const tokens = lookTokens(resolveLook(GRID, defaults(GRID), "dark"));
    expect(tokens["--canvas"]).toMatch(/^oklch\(/);
    expect(tokens["--ink"]).toMatch(/^oklch\(/);
    expect(tokens["--muted-foreground"]).toMatch(/^color-mix\(in oklch, var\(--ink\) [\d.]+%, var\(--canvas\)\)$/);
    for (const [key, value] of Object.entries(tokens)) {
      if (!value.startsWith("color-mix")) continue;
      if (value.includes("transparent")) expect(value, key).toMatch(/^color-mix\(in oklab,/);
      else expect(value, key).toMatch(/^color-mix\(in oklch,/);
    }
    expect(tokens["--studio-glass-transcript"]).toBe("color-mix(in oklab, var(--canvas) 16%, transparent)");
    expect(tokens["--radius"]).toBe("0.125rem");
    expect(tokens["--font-sans"]).toBe(GRID.type.body);
  });

  it("leave the transcript to the host's column card with no backing of their own, keep a thread banner inside that column, give a full card only to a plugin page that has no column card of its own, make filter pills light glass with the selected one denser, card the composer's replacement, draw no 1px line on them or on the replacement's buttons, and leave the HUD and side-panel threads alone", () => {
    const tokens = lookTokens(resolveLook(GRID, defaults(GRID), "dark"));
    expect(tokens["--studio-glass-main"]).toBe("color-mix(in oklab, var(--canvas) 3%, transparent)");
    expect(tokens["--studio-blur-main"]).toBe("0px");
    for (const selector of Object.values(BACKING_SELECTORS)) {
      expect(THEME_CSS).toContain(selector === BACKING_SELECTORS.pages ? `${selector} header ~ [data-pane-content] {` : `${selector} {`);
      expect(selector).toMatch(/^html\[data-studio-glass\] /);
    }
    expect(Object.keys(BACKING_SELECTORS)).toEqual(["pages", "composerReplace", "threadBanner", "composerControls"]);
    expect(THEME_CSS.split(`${BACKING_SELECTORS.threadBanner} {`)[1]!.split("}")[0]).toContain("align-self: center; width: min(100%, var(--fork-cards-column, 100%)); border-radius: var(--studio-card-radius);");
    expect(BACKING_SELECTORS.composerControls).toBe('html[data-studio-glass] [data-thread-window]:not([data-surface-tone]) [data-fork-composer-replace] :is(button, a)');
    const controls = THEME_CSS.split(`${BACKING_SELECTORS.composerControls} {`)[1]!.split("}")[0]!;
    expect(controls).toContain("border-color: transparent;");
    expect(controls).toContain("background-color: color-mix(in oklab, var(--ink) 10%, transparent);");
    expect(THEME_CSS).toContain(`${BACKING_SELECTORS.composerControls}:hover { background-color: color-mix(in oklab, var(--ink) 18%, transparent); }`);
    expect(THEME_CSS).not.toContain("[data-scroll-attached] { background");
    expect(THEME_CSS).not.toContain("[data-follow-up-composer-footer]");
    expect(HALO_SELECTORS.column).toBe('html[data-studio-glass] [data-thread-window]:not([data-surface-tone]) [data-scroll-attached]');
    expect(THEME_CSS).toContain(`${PAGE_ROOTS} { background: transparent; }`);
    const pages = 'html[data-studio-glass] [data-sidebar="inset"]:not(:has([data-thread-window]:not([data-surface-tone])))';
    expect(PAGE_ROOTS).toBe(`${pages} :is(.studio-root.bg-background, [data-bot-page])`);
    expect(BACKING_SELECTORS.pages).toBe(`${pages}:has([data-testid="plugin-panel-body"]):not(:has([data-bot-page]))`);
    expect(HALO_SELECTORS.pages).toBe(pages);
    expect(THEME_CSS).not.toContain(`${pages} {`);
    expect(PILL_SELECTOR).toBe("html[data-studio-glass] [data-studio-pill]");
    expect(THEME_CSS).toContain(`${PILL_SELECTOR} { background-color: var(--pill-surface, var(--surface-recessed)); }`);
    expect(THEME_CSS).toContain(`${PILL_SELECTOR}:hover { background-color: var(--state-hover); }`);
    expect(THEME_CSS).toContain(`${PILL_SELECTOR}[data-state="on"] { background-color: var(--pill-surface-selected, var(--state-active)); }`);
    expect(THEME_CSS.indexOf(`${PILL_SELECTOR}[data-state="on"]`)).toBeGreaterThan(THEME_CSS.indexOf(`${PILL_SELECTOR}:hover`));
    const rule = THEME_CSS.split(`${BACKING_SELECTORS.pages} header ~ [data-pane-content] {`)[1]!.split("}")[0]!;
    expect(rule).toContain("background: var(--studio-glass-transcript);");
    expect(rule).toContain("backdrop-filter: blur(var(--studio-blur-transcript)) saturate(var(--studio-glass-saturate));");
    expect(rule).toContain("border-radius: var(--studio-card-radius);");
    expect(rule).toContain("border: 0;");
    expect(rule).toContain("box-shadow: var(--fork-cards-shadow, none);");
    expect(THEME_CSS.split(`${BACKING_SELECTORS.composerReplace} {`)[1]!.split("}")[0]).toContain("background: var(--studio-glass-composer); ");
    expect(THEME_CSS).not.toMatch(/-edge|-rim/);
    for (const line of THEME_CSS.split("\n")) if (!line.includes("needs-you") && !line.includes("table :is(th, td)")) expect(line).not.toMatch(/border(-(top|right|bottom|left|color|width|style))*:(?! (0|transparent);)/);
    expect(Object.keys(tokens).filter((name) => /-edge|-rim/.test(name))).toEqual([]);
    expect(tokens["--studio-card-radius"]).toBe("8px");
    expect(lookTokens(resolveLook(MIAMI, defaults(MIAMI), "dark"))["--studio-card-radius"]).toBe("8px");
    expect(tokens["--studio-halo"]).toBe(HALO_LAYERS.map((layer) => `0 0 ${layer.blur}px color-mix(in oklab, var(--canvas) ${Math.round(layer.alpha * 100)}%, transparent)`).join(", "));
    const halo = THEME_CSS.split("\n").find((line) => line.includes("text-shadow"))!;
    for (const selector of Object.values(HALO_SELECTORS)) expect(halo).toContain(selector);
    expect(halo).toContain("{ text-shadow: var(--studio-halo); }");
    expect(HALO_SELECTORS.sidebar).toBe('html[data-studio-glass] [data-sidebar="sidebar"]');
    expect(THEME_CSS).not.toContain("[data-studio-hud]");
  });

  it("tints a glass diff's line-number gutter like the diff body over the scene, not a darker canvas strip", () => {
    for (const theme of SCENE_THEMES.filter((each) => each.glass)) {
      for (const mode of themeModes(theme)) {
        const look = resolveLook(theme, defaults(theme), mode);
        const [dark, light] = backdropRange(theme, "transcript", look.intensity, look.mode);
        for (const surface of ["transcript", "composer"] as const) {
          const gutter = diffBody(look, surface);
          const lows = [diffBody(look, surface, dark!), diffBody(look, surface, light!)].map(luminance).sort((a, b) => a - b);
          expect(luminance(gutter), `${theme.id} ${mode} ${surface}`).toBeGreaterThanOrEqual(lows[0]! - 1e-9);
          expect(luminance(gutter), `${theme.id} ${mode} ${surface}`).toBeLessThanOrEqual(lows[1]! + 1e-9);
          expect(Math.abs(luminance(gutter) - luminance(look.canvas)), `${theme.id} ${mode} ${surface}`).toBeGreaterThan(0);
        }
        expect(lookTokens(look)["--studio-diff-gutter"]).toMatch(/^color-mix\(in oklab, oklch\(.+\) 90%, transparent\)$/);
      }
    }
  });

  it("draws the approval, question and queue cards, attachment and worker chips and toasts on glass without 1 px outlines, keeps a classic theme's composer footer opaque, and draws diffs on the canvas, or on glass with an opaque line-number gutter and no outline", () => {
    for (const card of ["approval-banner", "user-question-banner", "plugin-request-banner", "plan-review-banner"]) expect(PROMPT_CARDS).toContain(`[data-testid="${card}"]`);
    expect(PROMPT_CARDS).toContain('section[aria-label="Queued messages"]');
    expect(PROMPT_CARDS.startsWith("html[data-studio-glass] ")).toBe(true);
    expect(PROMPT_CARD_LINES).toContain(':is([class~="border-b"], [class~="border-t"], [class~="border"]:not(button, input, textarea, [role="radio"], [role="checkbox"]))');
    expect(THEME_CSS).toContain(`${GLASS_CHIPS} { border-color: transparent; background-color: color-mix(in oklab, var(--ink) 14%, transparent); }`);
    expect(GLASS_CHIPS).toContain("[data-promptbox-expanded-only] .rounded-full.border");
    expect(GLASS_CHIPS).toContain('[data-testid="conversation-workers"] button');
    expect(THEME_CSS).toContain(`${GLASS_CHIPS}:hover { background-color: color-mix(in oklab, var(--ink) 20%, transparent); }`);
    expect(THEME_CSS).toContain(`${CLASSIC_FOOTER} { background: var(--canvas); }`);
    expect(CLASSIC_FOOTER).toBe('html[data-studio-theme]:not([data-studio-glass]) [data-sidebar="inset"] [data-scroll-footer] > div');
    expect(THEME_CSS).toContain("html[data-studio-theme] diffs-container { --diffs-dark-bg: var(--canvas); --diffs-light-bg: var(--canvas); }");
    const glassDiff = THEME_CSS.split("html[data-studio-glass] diffs-container {")[1]!.split("}")[0]!;
    expect(glassDiff).toContain("--diffs-dark-bg: transparent; --diffs-light-bg: transparent;");
    expect(glassDiff).toContain("--fork-diffs-gutter-bg: var(--studio-diff-gutter);");
    expect(THEME_CSS).toContain("html[data-studio-glass] aside[data-surface-tone] diffs-container { --fork-diffs-gutter-bg: var(--studio-diff-gutter-panel); }");
    expect(THEME_CSS.indexOf("html[data-studio-glass] diffs-container {")).toBeGreaterThan(THEME_CSS.indexOf("html[data-studio-theme] diffs-container {"));
    expect(THEME_CSS).toContain(`${GLASS_DIFF_CARD} { border-color: transparent; background: var(--fork-panel); }`);
    expect(THEME_CSS).toContain(`${PROMPT_CARDS}, ${PROMPT_CARD_LINES}, ${STUDIO_RULE} { border-color: transparent; }`);
    expect(readFileSync(new URL("../code/file-opener.tsx", import.meta.url), "utf8")).toContain('<div data-studio-rule="" className="flex shrink-0 items-center gap-2 border-b');
    const toast = THEME_CSS.split(`${TOAST_CARD} {`)[1]!.split("}")[0]!;
    expect(TOAST_CARD).toBe("html[data-studio-glass] .bb-app-toast > div");
    expect(toast).toContain("border-color: transparent;");
    expect(toast).toContain("background: var(--fork-popover, var(--studio-glass-hud));");
    expect(toast).toContain("backdrop-filter: var(--fork-popover-filter, blur(12px));");
    expect(toast).toContain("border-radius: var(--studio-card-radius);");
  });

  it("gives a classic theme solid surfaces and no halo", () => {
    const tokens = lookTokens(resolveLook(CLASSIC_THEMES[2]!, defaults(CLASSIC_THEMES[2]!), "dark"));
    expect(tokens["--studio-halo"]).toBe("none");
    expect(tokens["--sidebar"]).toMatch(/^oklch\(/);
    expect(tokens["--studio-glass-transcript"]).toBe("color-mix(in oklab, var(--canvas) 100%, transparent)");
  });
});

describe("a crossfade between looks", () => {
  it("passes through a blend and lands on the new look", () => {
    const from = resolveLook(CLASSIC_THEMES[1]!, defaults(CLASSIC_THEMES[1]!), "dark");
    const to = resolveLook(GRID, defaults(GRID), "dark");
    const half = mixLooks(from, to, 0.5);
    expect(rgbToHex(half.canvas)).not.toBe(rgbToHex(from.canvas));
    expect(rgbToHex(half.canvas)).not.toBe(rgbToHex(to.canvas));
    expect(half.alpha.sidebar).toBeCloseTo((from.alpha.sidebar + to.alpha.sidebar) / 2, 5);
    expect(mixLooks(from, to, 1)).toBe(to);
    expect(mixLooks(from, to, 0)).toBe(from);
  });
});

describe("tables in a transcript under glass", () => {
  it("back the whole table, wide or not, with the transcript glass, drop the host's wings and keep only faint row lines", () => {
    expect(THEME_CSS).toContain(TABLE_CSS);
    expect(TABLE_CSS).toContain('html[data-studio-glass] [data-thread-window] [data-markdown-preview] .overflow-x-auto:has(> table) { background: var(--studio-glass-transcript);');
    expect(TABLE_CSS).toContain("::before, html[data-studio-glass] [data-thread-window] [data-markdown-preview] :has(> .overflow-x-auto > table)::after { display: none; }");
    expect(TABLE_CSS).toContain("table { border: 0; }");
    expect(TABLE_CSS).toContain("border-bottom: 1px solid color-mix(in oklab, var(--ink) 8%, transparent)");
  });
});

describe("the title row under glass", () => {
  const rule = (selector: string) => HEADER_CSS.split(`\n${selector} {`)[1]?.split("}")[0] ?? "";
  const boxes = `:is(${TITLE_BOX}, ${PAGE_BAR_BOX})`;
  const controlsEnd = "calc(var(--bb-window-title-bar-controls-end) + 12px - var(--bb-window-card-collapsed-left))";

  it("is a bare row above the card in bb's own header: no row in the card, no backing, no viewport position", () => {
    expect(HEADER_ROW).toBe('html[data-studio-glass] [data-sidebar="inset"] header > [data-testid="app-page-header-content-row"]');
    expect(TITLE_BOX).toBe(`${HEADER_ROW} > div:has(> [data-fork-title-home]):not([data-studio-bar-label])`);
    expect(PAGE_BAR_BOX).toBe(`${HEADER_ROW} [data-studio-page-bar="column"]`);
    expect(HEADER_CSS).not.toContain("data-studio-title-row");
    expect(HEADER_CSS).not.toContain("position: sticky");
    expect(HEADER_CSS).not.toContain("animation");
    expect(HEADER_CSS).not.toMatch(/--studio-row-[xyw]|translate:|anchor/);
    expect(rule('html[data-studio-glass] [data-sidebar="inset"] header')).toContain("background: transparent; padding-inline: 0;");
  });

  it("takes the card's own box: centered in the header of the same column, as wide as the card's content and inset like it, per kind of page", () => {
    const header = 'html[data-studio-glass] [data-sidebar="inset"] header';
    expect(rule(header)).toContain("--studio-title-width: var(--fork-cards-column, 808px); --studio-title-inset: var(--fork-cards-page-lead, 40px);");
    expect(rule(`${header}:has(+ [data-thread-window])`)).toBe(" --studio-title-width: 760px; --studio-title-inset: 24px; ");
    expect(rule(`${header}:has(~ * [data-resource-collection-viewport])`)).toBe(" --studio-title-width: 64rem; --studio-title-inset: 1.25rem; ");
    expect(rule(PAGE_BAR_BOX)).toBe(" --studio-title-width: 56rem; --studio-title-inset: 2rem; ");
    const box = rule(boxes);
    expect(box).toContain("position: absolute; inset: 0; box-sizing: border-box;");
    expect(box).toContain("width: 100%; max-width: var(--studio-title-width);");
    expect(box).toContain("margin-inline: auto; padding-inline: var(--studio-title-inset);");
    expect(box).toContain("filter: drop-shadow(");
    expect(rule(`${HEADER_ROW}[data-studio-bar-row]:has([data-studio-page-bar="column"]) [data-studio-bar-fill]`)).toBe(" position: static; ");
  });

  it("starts after the window's controls where the sidebar is collapsed and the card's edge is under them", () => {
    const reserved = `${HEADER_ROW}[class*="bb-window-title-bar-controls-end"]`;
    expect(rule(reserved)).toBe(` padding-left: ${controlsEnd}; `);
    expect(rule(`${reserved} ${boxes}`)).toBe(` padding-left: max(var(--studio-title-inset), calc(${controlsEnd} - max(0px, (100cqw - var(--studio-title-width)) / 2))); `);
  });

  it("lays bb's own title group out in the box: the title and the Bot's words left, Pop out and the thread menu right, with no pill, and the row's actions stay at the window's edge", () => {
    const group = rule(`${TITLE_BOX} [data-fork-header-group="title"]`);
    expect(group).toContain("flex: 1;");
    expect(group).toContain("background: transparent;");
    expect(rule(`${TITLE_BOX} [data-fork-thread-header-after], ${TITLE_BOX} [data-fork-thread-header-after] > .studio-root`)).toBe(" flex: 1; ");
    expect(rule(`${TITLE_BOX} [data-fork-thread-header-after] [data-testid="hud-pop-out"], ${TITLE_BOX} [data-fork-header-group="title"] > span:last-child`)).toBe(" margin-left: auto; ");
    expect(rule(`${HEADER_ROW} > :has(> [data-fork-header-group="actions"]), ${HEADER_ROW} > [data-fork-header-group="actions"]`)).toBe(" margin-left: auto; ");
    expect(rule(`${boxes} > *`)).toBe(" pointer-events: auto; ");
  });

  it("positions the title with no fixed, anchored or measured value: only the header's own box, the cards' width variables and bb's title bar variables", () => {
    expect(HEADER_CSS).not.toMatch(/position:\s*fixed|anchor-name|position-anchor|anchor\(|translate|transform|getBoundingClientRect/);
    expect(HEADER_CSS).not.toMatch(/(?:^|[\s;{])(?:top|left|right|bottom):/m);
    const lengths = [...HEADER_CSS.matchAll(/(?<![\w-])(?:max-width|width|padding-left|padding-inline|inset):\s*([^;]+);/g)].map((each) => each[1]!);
    expect(lengths.length).toBeGreaterThan(6);
    for (const value of lengths) expect(value).toMatch(/^(0|none|100%|16px|var\(--studio-title-(?:width|inset)\)|calc\(var\(--bb-window-title-bar-controls-end\) \+ 12px - var\(--bb-window-card-collapsed-left\)\)|max\(var\(--studio-title-inset\), calc\(calc\(var\(--bb-window-title-bar-controls-end\) \+ 12px - var\(--bb-window-card-collapsed-left\)\) - max\(0px, \(100cqw - var\(--studio-title-width\)\) \/ 2\)\)\))$/);
    const thread = rule('html[data-studio-glass] [data-sidebar="inset"] header:has(+ [data-thread-window])');
    expect(thread).toContain("--studio-title-width: 760px; --studio-title-inset: 24px;");
  });

  it("starts the transcript card, the workbench's body and the sidebar card at one height, the title bar's: the header ends there, the tab strip is that tall and the sidebar card has no top padding", () => {
    const framed = 'html[data-studio-glass] [data-testid="app-layout-root"][data-framed]';
    expect(GUTTER_CSS).toContain(`${framed} [data-sidebar="inset"] header.box-content { padding-bottom: 0; }`);
    expect(GUTTER_CSS).toContain(`${WORKBENCH_STRIP} { box-sizing: border-box; height: var(--bb-window-title-bar-height);`);
    expect(GUTTER_CSS).toContain(`${WORKBENCH} { top: 0; height: 100%; }`);
    expect(GUTTER_CSS).toContain(`${framed} [data-sidebar="sidebar"] > :has(> [data-sidebar="collapsible-body"]) { padding-top: 0;`);
    expect(GUTTER_CSS).toContain("height: calc(100% + var(--bb-window-title-bar-height) - calc(var(--fork-cards-gap, 10px) - var(--bb-frame-window-lip, 0px)));");
    expect(GUTTER_CSS).not.toMatch(/(?:top|height):\s*4[45]px/);
  });

  it("gives a settings list page with no card of its own (Installed plugins) the wide card, centered, and drops bb's scrollbar reserve so its column is centered in it", () => {
    expect(LIST_PAGE).toBe('html[data-studio-glass] [data-sidebar="inset"] header + main > div:has([data-resource-collection-viewport]):not(:has(.box-border.h-full.w-full, [data-page-scroll-viewport]))');
    expect(THEME_CSS).toContain(`${LIST_PAGE}::before { content: ""; position: absolute; z-index: -1; inset: 0; width: min(100%, var(--fork-cards-wide-column, 1032px)); margin-inline: auto; pointer-events: none; background: var(--studio-glass-transcript);`);
    expect(THEME_CSS).toContain(`${LIST_PAGE} .md\\:pr-3 { padding-right: 0; }`);
  });

  it("keeps Edit space's footer dense and gives its bare title row the halo", () => {
    expect(rule('html[data-studio-glass] [data-testid="edit-space-title-row"]')).toContain("filter: drop-shadow(");
    expect(rule('html[data-studio-glass] [data-testid="edit-space-pane"] [data-testid="theme-picker-actions"]')).toBe(" background: var(--studio-title-row-glass); -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); border-top-color: transparent; ");
  });
});

describe("no 1 px rules between rows under glass", () => {
  it("draws no divider in Studio's views in the main area and the side panel: every one-sided border and divide class loses its color", () => {
    expect(RULES).toBe('html[data-studio-glass] [data-sidebar="inset"] .studio-root :is([class~="border-b"], [class~="border-t"], [class~="border-y"], [class~="border-l"], [class~="border-r"], [class~="border-x"], [class*="divide-y"] > *, [class*="divide-x"] > *)');
    expect(THEME_CSS).toContain(`${RULES} { border-top-color: transparent; border-bottom-color: transparent; border-left-color: transparent; border-right-color: transparent; }`);
  });

  it("covers every divider class the Bot pages and the Todos, Automations, Memory, Library and Archive views use", () => {
    const roots = ["src/ui/bot-page", "src/ui/bot", "src/ui/loops", "src/loops", "src/ui/memory", "src/ui/library", "src/ui/conversations", "src/ui/automations", "src/automations"].map((each) => join(here, "../..", each)).filter((each) => existsSync(each));
    expect(roots.length).toBeGreaterThan(2);
    const files = roots.flatMap((root) => readdirSync(root, { recursive: true, encoding: "utf8" }).filter((name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx")).map((name) => join(root, name)));
    const used = new Set<string>();
    for (const file of files) for (const match of readFileSync(file, "utf8").matchAll(/(?<![\w:-])(border-[btlrxy](?:-\d+)?|divide-[xy](?:-\d+)?)(?![\w-])/g)) used.add(match[1]!);
    expect(used.size).toBeGreaterThan(1);
    const covered = (name: string) => (RULE_CLASSES as readonly string[]).includes(name) || name.startsWith("divide-") || /^border-[btlrxy]-\d+$/.test(name);
    expect([...used].filter((name) => !covered(name))).toEqual([]);
    expect([...used].filter((name) => /^border-[btlrxy]-\d+$/.test(name) && name !== "border-b-2" && name !== "border-l-2" && name !== "border-t-2")).toEqual([]);
  });
});

describe("gutters and scrollbars under glass", () => {
  it("keeps a card's shadow off its neighbours, gives the framed window the same gap on the right as between cards, and shows a scrollbar thumb only on hover with no track", () => {
    expect(THEME_CSS).toContain(GUTTER_CSS);
    expect(SHADOW_CLIP_SELECTORS).toHaveLength(4);
    expect(GUTTER_CSS).toContain(`${SHADOW_CLIP_SELECTORS.join(", ")} { clip-path: inset(-60px 0); }`);
    const gap = "calc(var(--fork-cards-gap, 10px) - var(--bb-frame-window-lip, 0px))";
    const framed = 'html[data-studio-glass] [data-testid="app-layout-root"][data-framed]';
    expect(GUTTER_CSS).toContain(`${framed} [data-sidebar="inset"] { margin-right: ${gap}; margin-bottom: ${gap}; height: calc(100% + var(--bb-window-title-bar-height) - ${gap}); padding-bottom: 0; }`);
    expect(GUTTER_CSS).toContain(`${framed} [data-sidebar="inset"] header.box-content { padding-bottom: 0; }`);
    expect(GUTTER_CSS).toContain(`${framed} [data-sidebar="sidebar"] > :has(> [data-sidebar="collapsible-body"]) { padding-top: 0; padding-bottom: ${gap}; }`);
    expect(WORKBENCH).toBe(`:is(${framed} [data-sidebar="inset"] aside[data-surface-tone="sidebar"]:not([inert], [data-app-content-shell] > header ~ * aside))`);
    expect(GUTTER_CSS).toContain(`${WORKBENCH} { top: 0; height: 100%; }`);
    expect(GUTTER_CSS).toContain(`${WORKBENCH}, ${WORKBENCH} [data-split-pane-id] { background: none; -webkit-backdrop-filter: none; backdrop-filter: none; box-shadow: none;`);
    expect(WORKBENCH_STRIP).toBe(`:is(${WORKBENCH} > div:not([data-sidebar-split-container]) > :first-child, ${WORKBENCH} [data-split-pane-id] > section > :first-child)`);
    expect(WORKBENCH_BODY).toBe(`:is(${WORKBENCH} > div:not([data-sidebar-split-container]) > :first-child ~ *, ${WORKBENCH} [data-split-pane-id] > section > :first-child ~ *)`);
    expect(GUTTER_CSS).toContain(`${WORKBENCH_STRIP} { box-sizing: border-box; height: var(--bb-window-title-bar-height); filter: drop-shadow(`);
    expect(GUTTER_CSS).toContain(`${WORKBENCH_BODY} { background: var(--fork-surface-secondary-panel-background, transparent);`);
    expect(GUTTER_CSS).toContain(`${WORKBENCH} [data-sidebar-split-root-direction="row"] > [data-split-pane-id]:not([data-split-pane-id="pane-primary"]) { padding-left: var(--fork-cards-gap, 10px); }`);
    expect(SHADOW_CLIP_SELECTORS).toContain(WORKBENCH_BODY);
    expect(GUTTER_CSS).toContain(`${SCROLLER_SELECTORS.join(", ")} { scrollbar-width: thin; scrollbar-color: transparent transparent; }`);
    for (const selector of SCROLLER_SELECTORS) expect(GUTTER_CSS).toContain(`${selector}:hover`);
    expect(GUTTER_CSS).not.toContain("[data-page-scroll-viewport] {");
    expect(GUTTER_CSS).not.toContain("[data-bot-page-scroll]");
  });
});

describe("bb's chrome under Studio", () => {
  it("hides the header's Open in button always, and under glass draws no divider between the transcript and the workbench and no rule under the info rows", () => {
    expect(THEME_CSS).toContain(CHROME_CSS);
    expect(CHROME_CSS).toContain('\n[data-thread-header-responsive-action]:has(button[aria-label^="Open workspace in"]) { display: none; }');
    expect(CHROME_CSS).toContain('html[data-studio-glass] [role="separator"][data-resize-handle]:not([data-resize-handle-state="drag"]):not(:hover) > span { background: transparent; }');
    expect(CHROME_CSS).toContain("border-bottom-width: 0;");
    expect(THEME_CSS).toContain(HEADER_CSS);
    expect(HEADER_CSS).not.toMatch(/anchor|position: fixed|50%|409|66px/);
    expect(HEADER_CSS).toContain(':is([data-fork-header-group], [data-sidebar="trigger"]) { background: transparent;');
    expect(HEADER_CSS).toContain('html[data-studio-glass] [data-sidebar="inset"] header { border-color: transparent; background: transparent; padding-inline: 0;');
  });
});
