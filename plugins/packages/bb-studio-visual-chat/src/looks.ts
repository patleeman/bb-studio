// Canvas looks (round 2 prototype): the design directions a canvas can
// render in, behind one per-canvas setting so every direction runs from the
// same code. A look is an accent layer on BB's theme (theme.ts): its type,
// scale, spacing, accent and highlighter over BB's ground, ink, rules and
// cards; its layout rules (organic.ts); and its design guide for the agent
// (guides.ts). "classic" is round 1: the slide
// grid and Studio's widget cards, for canvases made before looks existed.
//
// Tokens are CSS custom properties (--cv-*). The page sets them on the board,
// and every custom frame gets the same ones, with the helper kit (ui/kit.ts),
// so the agent's generated components match the built-in ones.
import { z } from "zod";
import { contrast, fitColor, fitHue, mix, oklchToRgb, rgb, rgbToOklch, toHex, type BbTheme } from "./theme";

export const LOOKS = ["editorial", "field", "instrument", "classic"] as const;
export type Look = (typeof LOOKS)[number];
// Pure, so the board renderer (bundle/canvas-renderer.js), which never validates, leaves zod out.
export const lookSchema = /* @__PURE__ */ z.enum(LOOKS);
/** Organic looks: everything but classic. */
export type OrganicLook = Exclude<Look, "classic">;
export const ORGANIC_LOOKS: readonly OrganicLook[] = ["editorial", "field", "instrument"];
export const DEFAULT_LOOK: OrganicLook = "editorial";

export const LOOK_INFO: Record<Look, { name: string; line: string }> = {
  editorial: { name: "Editorial", line: "a newspaper or magazine spread: serif headlines, hairline rules, generous margins" },
  field: { name: "Field notes", line: "a designer's whiteboard: marker headlines, hand-written words, bright highlights" },
  instrument: { name: "Instrument", line: "a control room: dense and precise, mono labels, big tabular numbers, hairline panels" },
  classic: { name: "Classic", line: "Round 1: the slide grid with Studio's widget cards." },
};

export const isLook = (value: unknown): value is Look => typeof value === "string" && (LOOKS as readonly string[]).includes(value);
export const lookOf = (value: unknown): Look => (isLook(value) ? value : "classic");

type Palette = Record<string, string>;

/**
 * A style is an accent layer on BB's theme (theme.ts): its type, scale and
 * spacing, its accent color and highlighter, and its rules. The ground, text,
 * rules and card surfaces are BB's, so a board matches BB in light, in dark
 * and in any palette; no style brings its own background.
 */
interface LookLayer {
  /** Font stacks, given BB's. Only system fonts in frames: they load nothing from the network. */
  fonts(theme: BbTheme): { display: string; text: string; label: string; num: string; hand: string };
  /** px: xs, sm, md, lg, xl, 2xl, 3xl, 4xl. */
  scale: [number, number, number, number, number, number, number, number];
  /** px: 1..6. */
  space: [number, number, number, number, number, number];
  /** The style's corners, at most BB's radius (null: BB's own). */
  radius: number | null;
  labelCase: "uppercase" | "none";
  labelTracking: string;
  displayWeight: number;
  /** The accent: an OKLCH hue and chroma, fitted to BB's ground so it reads in either mode. */
  accent: { h: number; c: number };
  /** The highlighter behind marked words: a hue, or null for the accent's. */
  highlight: { h: number; c: number } | null;
  /** Cards cast a soft shadow. */
  lift: boolean;
}

const SERIF = `"Iowan Old Style", "Charter", "Source Serif Pro", Georgia, "Times New Roman", serif`;
const HAND = `"Bradley Hand", "Noteworthy", "Segoe Print", "Comic Neue", cursive`;
const MARKER = `"Marker Felt", "Chalkboard SE", "Segoe Print", "Comic Neue", cursive`;
const DIN = `"DIN Alternate", "DIN Condensed", "Bahnschrift", "Roboto Condensed", system-ui, sans-serif`;

export const LOOK_LAYERS: Record<OrganicLook, LookLayer> = {
  // A serif display face over BB's sans, hairline rules, a red accent.
  editorial: {
    fonts: (theme) => ({ display: SERIF, text: theme.fonts.sans, label: theme.fonts.sans, num: SERIF, hand: SERIF }),
    scale: [11, 13, 16, 19, 25, 36, 52, 72],
    space: [4, 8, 14, 22, 34, 56],
    radius: 2,
    labelCase: "uppercase",
    labelTracking: "0.12em",
    displayWeight: 600,
    accent: { h: 27, c: 0.17 },
    highlight: { h: 95, c: 0.11 },
    lift: false,
  },
  // Marker headlines and hand-written labels, a blue accent, yellow highlighter.
  field: {
    fonts: (theme) => ({ display: MARKER, text: theme.fonts.sans, label: HAND, num: MARKER, hand: HAND }),
    scale: [12, 14, 16, 19, 25, 34, 46, 62],
    space: [4, 8, 12, 18, 28, 44],
    radius: null,
    labelCase: "none",
    labelTracking: "0",
    displayWeight: 400,
    accent: { h: 262, c: 0.19 },
    highlight: { h: 100, c: 0.15 },
    lift: true,
  },
  // Dense and precise: mono labels, condensed tabular numbers, an amber accent.
  instrument: {
    fonts: (theme) => ({ display: DIN, text: theme.fonts.sans, label: theme.fonts.mono, num: DIN, hand: theme.fonts.mono }),
    scale: [10, 12, 13, 15, 20, 28, 40, 56],
    space: [2, 4, 6, 10, 16, 24],
    radius: 3,
    labelCase: "uppercase",
    labelTracking: "0.08em",
    displayWeight: 600,
    accent: { h: 65, c: 0.16 },
    highlight: null,
    lift: false,
  },
};

/** Named hues the kit paints with (dem/rep, good/bad, a series named "blue"…): OKLCH hue and chroma. */
const HUES: Record<string, { h: number; c: number }> = {
  blue: { h: 255, c: 0.15 }, red: { h: 27, c: 0.17 }, green: { h: 150, c: 0.13 }, amber: { h: 70, c: 0.14 }, purple: { h: 300, c: 0.14 }, teal: { h: 200, c: 0.1 },
};
/** Chart series after the first: hue turns from the lead series, spread so neighbours never look alike. */
const SERIES_TURNS = [180, 70, 250, 120, 300, 35];
/** Text on the ground reads at 4.5:1 (WCAG AA); marks (bars, lines, dots) at 3:1. */
export const TEXT_CONTRAST = 4.5;
export const MARK_CONTRAST = 3;
/** Below this OKLCH chroma BB's primary is a gray, too quiet to lead a chart. */
const GRAY_CHROMA = 0.04;

/**
 * A style's palette on BB's theme: the ground, card, ink, muted text and rules
 * are BB's; the accent, highlighter and every chart and named hue are fitted
 * to that ground so they read at TEXT_CONTRAST (text) or MARK_CONTRAST (marks).
 * Charts lead with BB's accent (its primary) when it has a color, else with
 * the style's, and run through hue turns from it, then BB's neutral range.
 */
export function lookPalette(look: OrganicLook, theme: BbTheme): Palette {
  const layer = LOOK_LAYERS[look];
  const c = theme.colors;
  const ground = rgb(c.background);
  const ink = rgb(c.foreground);
  const dark = theme.mode === "dark";
  // Where a hue starts before it's fitted: mid lightness, a step lighter on a dark ground.
  const startL = dark ? 0.74 : 0.56;
  const hue = (h: number, chroma: number, min: number) => toHex(fitHue(h, chroma, startL, ground, min));
  const accent = rgb(hue(layer.accent.h, layer.accent.c, TEXT_CONTRAST));
  const primary = rgbToOklch(rgb(c.primary));
  const lead = primary.c >= GRAY_CHROMA ? fitColor(rgb(c.primary), ground, MARK_CONTRAST) : fitHue(layer.accent.h, layer.accent.c, startL, ground, MARK_CONTRAST);
  const leadLch = rgbToOklch(lead);
  const leadC = Math.max(0.11, Math.min(0.16, leadLch.c));
  const series = [toHex(lead), ...SERIES_TURNS.slice(0, 5).map((turn) => hue((leadLch.h + turn) % 360, leadC, MARK_CONTRAST))];
  const muted = toHex(fitColor(rgb(c.mutedForeground), ground, TEXT_CONTRAST));
  const neutral = toHex(fitColor(mix(ink, ground, 0.5), ground, MARK_CONTRAST));
  const highlightHue = layer.highlight ?? layer.accent;
  const highlight = toHex(mix(oklchToRgb({ l: dark ? 0.6 : 0.9, c: highlightHue.c, h: highlightHue.h }), ground, dark ? 0.38 : 0.7));
  const semantic = (color: string, fallback: { h: number; c: number }) => {
    const lch = rgbToOklch(rgb(color));
    return lch.c >= GRAY_CHROMA ? toHex(fitColor(rgb(color), ground, TEXT_CONTRAST)) : hue(fallback.h, fallback.c, TEXT_CONTRAST);
  };
  const accentInk = contrast(accent, ground) >= contrast(accent, ink) ? c.background : c.foreground;
  const named = Object.fromEntries(Object.entries(HUES).map(([name, { h, c: chroma }]) => [name, hue(h, chroma, MARK_CONTRAST)]));
  return {
    paper: c.background,
    surface: c.card,
    ink: c.foreground,
    "ink-2": toHex(mix(ink, ground, 0.86)),
    muted,
    rule: c.border,
    "rule-strong": c.foreground,
    accent: toHex(accent),
    "accent-ink": accentInk,
    good: semantic(c.success, HUES.green!),
    bad: semantic(c.destructive, HUES.red!),
    warn: semantic(c.warning, HUES.amber!),
    highlight,
    ...named,
    gray: muted,
    c1: series[0]!, c2: series[1]!, c3: series[2]!, c4: series[3]!, c5: series[4]!, c6: series[5]!, c7: neutral, c8: muted,
    shadow: layer.lift ? (dark ? "0 1px 0 rgb(0 0 0 / 0.2), 0 12px 26px -12px rgb(0 0 0 / 0.7)" : "0 1px 0 rgb(0 0 0 / 0.04), 0 10px 22px -12px rgb(0 0 0 / 0.28)") : "none",
  };
}

/** The accents quotes take in any style, and each style's own. A retired "sticky" falls back to the style's own. */
export const QUOTE_ACCENTS = ["pull", "bar"] as const;
export type QuoteAccent = (typeof QUOTE_ACCENTS)[number];
export const NATIVE_ACCENT: Record<OrganicLook, { quote: QuoteAccent }> = {
  editorial: { quote: "pull" },
  field: { quote: "pull" },
  instrument: { quote: "bar" },
};
/** An item's accent: its options.accent when it's one its kind takes, else the style's own. */
export function accentOf(kind: string, options: Record<string, unknown> | undefined, look: OrganicLook): string | null {
  const asked = options?.accent;
  if (kind === "quote") return typeof asked === "string" && (QUOTE_ACCENTS as readonly string[]).includes(asked) ? asked : NATIVE_ACCENT[look].quote;
  return null;
}

/** Color tokens, registered so a style switch cross-fades them. */
export const COLOR_TOKENS = ["paper", "surface", "ink", "ink-2", "muted", "rule", "rule-strong", "accent", "accent-ink", "good", "bad", "warn", "highlight", "blue", "red", "green", "amber", "purple", "teal", "gray", "c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"];

const SCALE_NAMES = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl"] as const;

/** The token declarations for one look on BB's theme, as CSS (no selector). */
export function tokenDeclarations(look: OrganicLook, theme: BbTheme): string {
  const layer = LOOK_LAYERS[look];
  const lines: string[] = [];
  for (const [name, value] of Object.entries(lookPalette(look, theme))) lines.push(`--cv-${name}:${value}`);
  // A pull quote keeps its serif face in every style.
  lines.push(`--cv-font-margin:${SERIF}`);
  for (const [name, value] of Object.entries(layer.fonts(theme))) lines.push(`--cv-font-${name}:${value}`);
  layer.scale.forEach((px, index) => lines.push(`--cv-t-${SCALE_NAMES[index]}:${px}px`));
  layer.space.forEach((px, index) => lines.push(`--cv-s-${index + 1}:${px}px`));
  const radius = layer.radius === null ? theme.radius : Math.min(layer.radius, theme.radius);
  lines.push(`--cv-radius:${radius}px`, `--cv-radius-sm:${Math.min(radius, Math.max(2, radius - 4))}px`, `--cv-label-case:${layer.labelCase}`, `--cv-label-tracking:${layer.labelTracking}`, `--cv-display-weight:${layer.displayWeight}`);
  return lines.join(";");
}

/** The palette's chart colors, c1..c8, for one look on BB's theme. */
export function chartColors(look: OrganicLook, theme: BbTheme): string[] {
  const palette = lookPalette(look, theme);
  return [1, 2, 3, 4, 5, 6, 7, 8].map((index) => palette[`c${index}`]!);
}

/** The token names an agent can use, for the guide. */
export const TOKEN_HELP = [
  "Colors: --cv-paper (board ground), --cv-surface (card), --cv-ink, --cv-ink-2, --cv-muted, --cv-rule, --cv-rule-strong, --cv-accent, --cv-accent-ink, --cv-good, --cv-bad, --cv-warn, --cv-highlight; hues --cv-blue, --cv-red, --cv-green, --cv-amber, --cv-purple, --cv-teal, --cv-gray; chart series --cv-c1 … --cv-c8.",
  "Type: --cv-font-display, --cv-font-text, --cv-font-label, --cv-font-num, --cv-font-hand; sizes --cv-t-xs, -sm, -md, -lg, -xl, -2xl, -3xl, -4xl; --cv-display-weight.",
  "Space and shape: --cv-s-1 … --cv-s-6, --cv-radius, --cv-radius-sm.",
].join("\n");
