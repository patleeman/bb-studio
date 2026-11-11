import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { forkCssRules } from "./fork-css-cascade";

const here = dirname(fileURLToPath(import.meta.url));
const themeCss = readFileSync(join(here, "../components/ui/theme.css"), "utf8");

export const SURFACE_SOURCE_ROOTS = [
  join(here, ".."),
  join(here, "../../../../packages/shared-ui/src"),
];

export const OPAQUE_ON_PURPOSE: Readonly<Record<string, string>> = {
  popover: "popovers, menus, dialogs and tooltips float over content",
  foreground: "inverse buttons, badges and pills",
  primary: "primary buttons, switches and progress fills",
  destructive: "destructive buttons and status dots",
  success: "status dots and fills",
  warning: "status dots and fills",
  attention: "status dots and fills",
  "muted-foreground": "status dots and separators",
  "destructive-text": "status dots",
  "warning-text": "status dots",
  "accent-foreground": "status dots",
  "timeline-accent": "timeline markers",
  "diff-added": "diff bars",
  "diff-removed": "diff bars",
  ring: "focus and selection marks",
  border: "hairlines",
  "border-seam": "hairlines",
  "sidebar-border": "hairlines",
  input: "control tracks",
  black: "media stages and scrims",
  "sidebar-accent": "the sidebar's selected row, set by the backdrop's tokens",
  "[var(--sidebar-search-match)]": "search match marks",
  "[--color-bg]": "a color swatch",
  "[linear-gradient(var(--surface-recessed),var(--surface-recessed))]":
    "the framed window's sidebar wash, a translucent token",
};

const NOT_A_FILL =
  /^(transparent|none|current|inherit|clip-.*|origin-.*|no-repeat|repeat.*|cover|contain|auto|center|top|bottom|left|right|fixed|local|scroll|blend-.*|size-.*|position-.*|gradient-to-.*|linear-.*|radial.*|conic.*|\[length:.*|\[position:.*|\[size:.*)$/u;

const STATE_VARIANT =
  /^(hover|focus|focus-visible|focus-within|active|disabled|checked|open|selected|placeholder|file|data-.*|aria-.*|group-.*|peer-.*|has-.*|not-.*|in-.*|supports-.*|\[.*\])$/u;

export interface BackgroundUtility {
  name: string;
  alpha: string | null;
  variants: string[];
  stateful: boolean;
}

export function backgroundUtility(className: string): BackgroundUtility | null {
  const segments: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of className) {
    if (char === "[" || char === "(") depth += 1;
    if (char === "]" || char === ")") depth -= 1;
    if (char === ":" && depth === 0) {
      segments.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  const bare = current.replace(/^!|!$/gu, "");
  const match = /^bg-(\[[^\]]*\]|[a-z][a-z0-9-]*)(?:\/(.+))?$/u.exec(bare);
  if (match === null) return null;
  const name = match[1] ?? "";
  if (NOT_A_FILL.test(name)) return null;
  return {
    name,
    alpha: match[2] ?? null,
    variants: segments,
    stateful: segments.some(
      (variant) =>
        STATE_VARIANT.test(variant) && !/^group-data-\[framed\]/u.test(variant),
    ),
  };
}

function isFaintTint(value: string): boolean {
  const match =
    /^color-mix\(\s*in oklab,\s*[^,]+ ([\d.]+)%,\s*transparent\s*\)$/u.exec(
      value.replace(/\s+/gu, " ").trim(),
    );
  return match !== null && Number(match[1]) <= 30;
}

export function translucentThemeTokens(): Set<string> {
  const values = new Map<string, string[]>();
  for (const match of themeCss.matchAll(/^\s*--([a-z0-9-]+):\s*([^;]+);/gmu)) {
    const name = match[1] ?? "";
    values.set(name, [...(values.get(name) ?? []), match[2] ?? ""]);
  }
  const translucent = new Set<string>();
  for (const [name, declared] of values) {
    if (name.startsWith("color-")) continue;
    if (declared.every(isFaintTint)) translucent.add(name);
  }
  return translucent;
}

const SEE_THROUGH_VALUE =
  /^(transparent|var\(--fork-(panel|code)\)|var\(--(surface-recessed|surface-raised|state-active)\)|color-mix\(\s*in oklab, var\(--ink\) [\d.]+%, transparent\s*\))$/u;

export interface TokenRemap {
  token: string;
  scope: string;
  value: string;
}

export function backdropTokenRemaps(): TokenRemap[] {
  const remaps: TokenRemap[] = [];
  for (const rule of forkCssRules()) {
    if (rule.pseudo !== "") continue;
    if (!/^html(\.dark)?\[data-fork-backdrop\] /u.test(rule.selector)) continue;
    for (const [property, value] of rule.declarations) {
      if (!property.startsWith("--") || property.startsWith("--fork-"))
        continue;
      if (property.startsWith("--tw-")) continue;
      remaps.push({ token: property.slice(2), scope: rule.selector, value });
    }
  }
  return remaps;
}

export function isSeeThroughValue(value: string): boolean {
  return SEE_THROUGH_VALUE.test(value);
}

export function ruledBackgroundClasses(): Set<string> {
  const classes = new Set<string>();
  for (const rule of forkCssRules()) {
    if (!rule.selector.startsWith("html[data-fork-backdrop] ")) continue;
    if (!rule.declarations.has("background")) continue;
    for (const match of rule.selector.matchAll(
      /\.(bg-[a-z0-9-]+(?:\\\/\d+)?)/gu,
    )) {
      classes.add((match[1] ?? "").replace("\\", ""));
    }
  }
  return classes;
}

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "generated") continue;
      files.push(...sourceFiles(path));
    } else if (
      /\.tsx?$/u.test(entry.name) &&
      !/\.(test|stories|fork\.test)\.tsx?$/u.test(entry.name) &&
      !path.includes("/test/")
    ) {
      files.push(path);
    }
  }
  return files;
}

export function sourceBackgroundUtilities(): Map<string, BackgroundUtility> {
  const found = new Map<string, BackgroundUtility>();
  for (const root of SURFACE_SOURCE_ROOTS) {
    for (const file of sourceFiles(root)) {
      const text = readFileSync(file, "utf8");
      for (const word of text.split(/[\s"'`]+/u)) {
        if (!word.includes("bg-")) continue;
        const utility = backgroundUtility(word);
        if (utility === null || utility.stateful) continue;
        found.set(
          utility.alpha === null
            ? utility.name
            : `${utility.name}/${utility.alpha}`,
          utility,
        );
      }
    }
  }
  return found;
}

export type SurfaceVerdict =
  | "translucent"
  | "remapped"
  | "ruled"
  | "opaque on purpose"
  | "opaque";

export function surfaceVerdict(utility: BackgroundUtility): SurfaceVerdict {
  if (translucentThemeTokens().has(utility.name)) return "translucent";
  if (backdropTokenRemaps().some((remap) => remap.token === utility.name)) {
    return "remapped";
  }
  const className =
    utility.alpha === null
      ? `bg-${utility.name}`
      : `bg-${utility.name}/${utility.alpha}`;
  if (ruledBackgroundClasses().has(className)) return "ruled";
  if (utility.name in OPAQUE_ON_PURPOSE) return "opaque on purpose";
  return "opaque";
}
