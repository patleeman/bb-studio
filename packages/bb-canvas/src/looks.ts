// Canvas looks (round 2 prototype): the design directions a canvas can
// render in, behind one per-canvas setting so every direction runs from the
// same code. A look is its design tokens (type scale, palette for light and
// dark, spacing, radii, chart colors), its layout rules (organic.ts) and its
// design guide for the agent (guides.ts). "classic" is round 1: the slide
// grid and Studio's widget cards, for canvases made before looks existed.
//
// Tokens are CSS custom properties (--cv-*). The page sets them on the board,
// and every custom frame gets the same ones, with the helper kit (ui/kit.ts),
// so the agent's generated components match the built-in ones.
import { z } from "zod";

export const LOOKS = ["editorial", "field", "instrument", "classic"] as const;
export type Look = (typeof LOOKS)[number];
export const lookSchema = z.enum(LOOKS);
/** Organic looks: everything but classic. */
export type OrganicLook = Exclude<Look, "classic">;
export const ORGANIC_LOOKS: readonly OrganicLook[] = ["editorial", "field", "instrument"];
export const DEFAULT_LOOK: OrganicLook = "editorial";

export const LOOK_INFO: Record<Look, { name: string; line: string }> = {
  editorial: { name: "Editorial", line: "A newspaper front: a big lead story with sidebars orbiting it, serif type, rules instead of cards, pull quotes and inline sparklines." },
  field: { name: "Field notes", line: "A whiteboard: cards and sticky notes loosely pinned around the focus, hand-drawn connectors and arrows that point at things." },
  instrument: { name: "Instrument", line: "A dense control panel: tight hairline panels, small multiples, maps and timelines, mono labels and big tabular numbers." },
  classic: { name: "Classic", line: "Round 1: the slide grid with Studio's widget cards." },
};

export const isLook = (value: unknown): value is Look => typeof value === "string" && (LOOKS as readonly string[]).includes(value);
export const lookOf = (value: unknown): Look => (isLook(value) ? value : "classic");

type Palette = Record<string, string>;
interface LookTokens {
  /** Font stacks. Only system fonts: frames load nothing from the network. */
  fonts: { display: string; text: string; label: string; num: string; hand: string };
  /** px: xs, sm, md, lg, xl, 2xl, 3xl, 4xl. */
  scale: [number, number, number, number, number, number, number, number];
  /** px: 1..6. */
  space: [number, number, number, number, number, number];
  radius: number;
  radiusSm: number;
  labelCase: "uppercase" | "none";
  labelTracking: string;
  displayWeight: number;
  light: Palette;
  dark: Palette;
}

const SERIF = `"Iowan Old Style", "Charter", "Source Serif Pro", Georgia, "Times New Roman", serif`;
const CONDENSED = `"Avenir Next Condensed", "Helvetica Neue", "Arial Narrow", system-ui, sans-serif`;
const SANS = `"Avenir Next", "Helvetica Neue", system-ui, -apple-system, "Segoe UI", sans-serif`;
const HAND = `"Bradley Hand", "Noteworthy", "Segoe Print", "Comic Neue", cursive`;
const MARKER = `"Marker Felt", "Chalkboard SE", "Segoe Print", "Comic Neue", cursive`;
const MONO = `ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace`;
const DIN = `"DIN Alternate", "DIN Condensed", "Bahnschrift", "Roboto Condensed", system-ui, sans-serif`;

export const LOOK_TOKENS: Record<OrganicLook, LookTokens> = {
  editorial: {
    fonts: { display: SERIF, text: SERIF, label: CONDENSED, num: SERIF, hand: SERIF },
    scale: [11, 13, 16, 19, 25, 36, 52, 72],
    space: [4, 8, 14, 22, 34, 56],
    radius: 0,
    radiusSm: 2,
    labelCase: "uppercase",
    labelTracking: "0.12em",
    displayWeight: 600,
    light: {
      paper: "#f6f2ea", surface: "#fbf8f2", ink: "#1b1915", "ink-2": "#3d3830", muted: "#756d60", rule: "#d8d0c0", "rule-strong": "#1b1915",
      accent: "#b3261e", "accent-ink": "#ffffff", good: "#1d6b45", bad: "#b3261e", warn: "#a86a12", highlight: "#f3e3a6",
      blue: "#245a9c", red: "#c0392b", green: "#2f7d55", amber: "#c58b2b", purple: "#6a4c9c", teal: "#2b8191", gray: "#8a8172",
      c1: "#245a9c", c2: "#c0392b", c3: "#c58b2b", c4: "#2f7d55", c5: "#6a4c9c", c6: "#2b8191", c7: "#8a8172", c8: "#d46a3b",
      shadow: "none",
    },
    dark: {
      paper: "#14120f", surface: "#1b1814", ink: "#efe8db", "ink-2": "#d4ccbd", muted: "#a0978a", rule: "#3a342c", "rule-strong": "#efe8db",
      accent: "#ff6a5c", "accent-ink": "#14120f", good: "#5cc792", bad: "#ff6a5c", warn: "#e0a84a", highlight: "#5a4b1c",
      blue: "#6f9fe0", red: "#ff6a5c", green: "#5cc792", amber: "#e0a84a", purple: "#a98be0", teal: "#55bccc", gray: "#9c9384",
      c1: "#6f9fe0", c2: "#ff6a5c", c3: "#e0a84a", c4: "#5cc792", c5: "#a98be0", c6: "#55bccc", c7: "#9c9384", c8: "#f08b5c",
      shadow: "none",
    },
  },
  field: {
    fonts: { display: MARKER, text: SANS, label: HAND, num: MARKER, hand: HAND },
    scale: [12, 14, 16, 19, 25, 34, 46, 62],
    space: [4, 8, 12, 18, 28, 44],
    radius: 6,
    radiusSm: 3,
    labelCase: "none",
    labelTracking: "0",
    displayWeight: 400,
    light: {
      paper: "#f7f5ef", surface: "#ffffff", ink: "#22252a", "ink-2": "#3e434b", muted: "#7a7f87", rule: "#e3e0d7", "rule-strong": "#22252a",
      accent: "#2463eb", "accent-ink": "#ffffff", good: "#1c9a5a", bad: "#e0402f", warn: "#f08c00", highlight: "#fff19a",
      blue: "#2463eb", red: "#e0402f", green: "#1c9a5a", amber: "#f08c00", purple: "#7b4fd6", teal: "#0f9aa8", gray: "#8a8f96",
      c1: "#2463eb", c2: "#e0402f", c3: "#1c9a5a", c4: "#f08c00", c5: "#7b4fd6", c6: "#0f9aa8", c7: "#8a8f96", c8: "#d6409f",
      sticky: "#fff3a6", "sticky-2": "#ffd6e0", "sticky-3": "#d4ecff", "sticky-ink": "#2b2a24",
      shadow: "0 1px 0 rgb(0 0 0 / 0.04), 0 10px 22px -12px rgb(40 36 20 / 0.35)",
    },
    dark: {
      paper: "#1d2124", surface: "#272c30", ink: "#eef0ee", "ink-2": "#cfd4d2", muted: "#9aa2a6", rule: "#3a4146", "rule-strong": "#eef0ee",
      accent: "#7aa7ff", "accent-ink": "#11161c", good: "#5fd394", bad: "#ff7a6b", warn: "#ffb547", highlight: "#5b5220",
      blue: "#7aa7ff", red: "#ff7a6b", green: "#5fd394", amber: "#ffb547", purple: "#b597ff", teal: "#4fd1dc", gray: "#a0a7ab",
      c1: "#7aa7ff", c2: "#ff7a6b", c3: "#5fd394", c4: "#ffb547", c5: "#b597ff", c6: "#4fd1dc", c7: "#a0a7ab", c8: "#ff8cc6",
      sticky: "#e9d96a", "sticky-2": "#f0a9bb", "sticky-3": "#9fcff5", "sticky-ink": "#1f1e18",
      shadow: "0 1px 0 rgb(0 0 0 / 0.2), 0 12px 26px -12px rgb(0 0 0 / 0.7)",
    },
  },
  instrument: {
    fonts: { display: DIN, text: SANS, label: MONO, num: DIN, hand: MONO },
    scale: [10, 12, 13, 15, 20, 28, 40, 56],
    space: [2, 4, 6, 10, 16, 24],
    radius: 3,
    radiusSm: 2,
    labelCase: "uppercase",
    labelTracking: "0.08em",
    displayWeight: 600,
    light: {
      paper: "#eef0ec", surface: "#fbfcfa", ink: "#12161a", "ink-2": "#2f363d", muted: "#69737c", rule: "#d3d8d4", "rule-strong": "#12161a",
      accent: "#d9820b", "accent-ink": "#12161a", good: "#178a4c", bad: "#d6342a", warn: "#d9820b", highlight: "#ffe7b3",
      blue: "#1f6fd1", red: "#d6342a", green: "#178a4c", amber: "#d9820b", purple: "#7547c9", teal: "#0a8f9e", gray: "#7d868e",
      c1: "#1f6fd1", c2: "#d6342a", c3: "#0a8f9e", c4: "#d9820b", c5: "#7547c9", c6: "#178a4c", c7: "#7d868e", c8: "#c2418f",
      shadow: "none",
    },
    dark: {
      paper: "#0a0d10", surface: "#11161b", ink: "#e6ebef", "ink-2": "#c2cad1", muted: "#7f8b96", rule: "#232b33", "rule-strong": "#e6ebef",
      accent: "#ffb020", "accent-ink": "#0a0d10", good: "#3ddc84", bad: "#ff5c4d", warn: "#ffb020", highlight: "#4a3710",
      blue: "#4ea1ff", red: "#ff5c4d", green: "#3ddc84", amber: "#ffb020", purple: "#a98bff", teal: "#2fd3e0", gray: "#8d98a3",
      c1: "#4ea1ff", c2: "#ff5c4d", c3: "#2fd3e0", c4: "#ffb020", c5: "#a98bff", c6: "#3ddc84", c7: "#8d98a3", c8: "#ff7ac8",
      shadow: "none",
    },
  },
};

const SCALE_NAMES = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl"] as const;

/** The token declarations for one look and mode, as CSS (no selector). */
export function tokenDeclarations(look: OrganicLook, mode: "light" | "dark"): string {
  const tokens = LOOK_TOKENS[look];
  const palette = tokens[mode];
  const lines: string[] = [];
  for (const [name, value] of Object.entries(palette)) lines.push(`--cv-${name}:${value}`);
  for (const [name, value] of Object.entries(tokens.fonts)) lines.push(`--cv-font-${name}:${value}`);
  tokens.scale.forEach((px, index) => lines.push(`--cv-t-${SCALE_NAMES[index]}:${px}px`));
  tokens.space.forEach((px, index) => lines.push(`--cv-s-${index + 1}:${px}px`));
  lines.push(`--cv-radius:${tokens.radius}px`, `--cv-radius-sm:${tokens.radiusSm}px`, `--cv-label-case:${tokens.labelCase}`, `--cv-label-tracking:${tokens.labelTracking}`, `--cv-display-weight:${tokens.displayWeight}`);
  return lines.join(";");
}

/** The palette's chart colors, c1..c8, for one look and mode. */
export function chartColors(look: OrganicLook, mode: "light" | "dark"): string[] {
  const palette = LOOK_TOKENS[look][mode];
  return [1, 2, 3, 4, 5, 6, 7, 8].map((index) => palette[`c${index}`]!);
}

/** The token names an agent can use, for the guide. */
export const TOKEN_HELP = [
  "Colors: --cv-paper (board ground), --cv-surface (card), --cv-ink, --cv-ink-2, --cv-muted, --cv-rule, --cv-rule-strong, --cv-accent, --cv-accent-ink, --cv-good, --cv-bad, --cv-warn, --cv-highlight; hues --cv-blue, --cv-red, --cv-green, --cv-amber, --cv-purple, --cv-teal, --cv-gray; chart series --cv-c1 … --cv-c8.",
  "Type: --cv-font-display, --cv-font-text, --cv-font-label, --cv-font-num, --cv-font-hand; sizes --cv-t-xs, -sm, -md, -lg, -xl, -2xl, -3xl, -4xl; --cv-display-weight.",
  "Space and shape: --cv-s-1 … --cv-s-6, --cv-radius, --cv-radius-sm.",
].join("\n");
