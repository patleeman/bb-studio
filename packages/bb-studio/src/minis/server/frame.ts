// A mini app's frame document, its compiled script, and the shelf files.
//
// The document is the version's HTML entry, or a plain one with #root for a
// JS entry, with this added to its head: the boot data (state, theme), the
// runtime (window.playground), the shelf libs the manifest lists, BB's
// colors as Tailwind theme tokens, and the app's modules. Its CSP sandboxes
// it into an opaque origin, allows scripts only from Studio and inline, and
// blocks every connection: the network goes through playground.fetch.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { appUrl, resolveLibs, shelfFile, shelfUrl, THEME_COLORS, type Manifest } from "../shared";

export class Shelf {
  private readonly files = new Map<string, Promise<{ text: string; hash: string }>>();
  constructor(private readonly dirs: readonly string[]) {}

  /** A shelf file's text and content hash; null for a name that isn't one. */
  async get(name: string): Promise<{ text: string; hash: string } | null> {
    if (!/^[a-z]+-\d+\.js$/.test(name)) return null;
    let file = this.files.get(name);
    if (!file) {
      file = (async () => {
        for (const dir of this.dirs) {
          try {
            const text = await readFile(join(dir, name), "utf8");
            return { text, hash: createHash("sha256").update(text).digest("hex").slice(0, 16) };
          } catch {
            // Try the next place it may be.
          }
        }
        throw new Error(`Shelf file ${name} is missing. Run node scripts/build-shelf.mjs.`);
      })();
      this.files.set(name, file);
      file.catch(() => this.files.delete(name));
    }
    return file;
  }
}

/** Defaults until the host sends BB's own colors (theme tokens), and outside BB. */
const DEFAULT_TOKENS = {
  light: {
    background: "#ffffff", foreground: "#18181b", card: "#ffffff", "card-foreground": "#18181b", popover: "#ffffff", "popover-foreground": "#18181b",
    primary: "#18181b", "primary-foreground": "#fafafa", secondary: "#f4f4f5", "secondary-foreground": "#18181b", muted: "#f4f4f5", "muted-foreground": "#71717a",
    "subtle-foreground": "#52525b", accent: "#f4f4f5", "accent-foreground": "#18181b", destructive: "#dc2626", "destructive-foreground": "#ffffff", "destructive-text": "#b91c1c",
    border: "#e4e4e7", input: "#e4e4e7", ring: "#a1a1aa", "state-hover": "rgba(0,0,0,0.05)", "state-active": "rgba(0,0,0,0.08)", success: "#15803d", warning: "#f59e0b",
    "warning-text": "#92400e", attention: "#ea580c", canvas: "#ffffff", ink: "#18181b", sidebar: "#fafafa",
  },
  dark: {
    background: "#18181b", foreground: "#fafafa", card: "#1f1f23", "card-foreground": "#fafafa", popover: "#1f1f23", "popover-foreground": "#fafafa",
    primary: "#fafafa", "primary-foreground": "#18181b", secondary: "#27272a", "secondary-foreground": "#fafafa", muted: "#27272a", "muted-foreground": "#a1a1aa",
    "subtle-foreground": "#d4d4d8", accent: "#27272a", "accent-foreground": "#fafafa", destructive: "#ef4444", "destructive-foreground": "#ffffff", "destructive-text": "#f87171",
    border: "#3f3f46", input: "#3f3f46", ring: "#71717a", "state-hover": "rgba(255,255,255,0.06)", "state-active": "rgba(255,255,255,0.1)", success: "#4ade80", warning: "#fbbf24",
    "warning-text": "#fbbf24", attention: "#fb923c", canvas: "#18181b", ink: "#fafafa", sidebar: "#1f1f23",
  },
} as const satisfies Record<"light" | "dark", Record<(typeof THEME_COLORS)[number], string>>;

const tokenBlock = (tokens: Record<string, string>) => Object.entries(tokens).map(([name, value]) => `--${name}:${value};`).join("");

/** Tailwind's theme: BB's colors as utilities (bg-background, text-muted-foreground, …), dark mode by class. */
export const THEME_CSS = `@custom-variant dark (&:where(.dark, .dark *));
@theme inline {
${THEME_COLORS.map((name) => `  --color-${name}: var(--${name});`).join("\n")}
  --font-sans: var(--ui-font, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif);
  --radius-sm: 4px; --radius-md: 6px; --radius-lg: 8px; --radius-xl: 12px;
}
@layer base {
  *, ::before, ::after { border-color: var(--border); }
  html, body { background: transparent; color: var(--foreground); font-family: var(--font-sans); }
  body { margin: 0; font-size: 14px; line-height: 1.45; -webkit-font-smoothing: antialiased; }
}`;

/** JSON for an inline script: no `</script>`, and no line separators JS strings once refused. */
const SEPARATORS = new RegExp(`[${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`, "g");
const escapeJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").replace(SEPARATORS, (char) => `\\u${char.charCodeAt(0).toString(16)}`);

export async function frameDocument(input: {
  miniId: string;
  versionId: string;
  manifest: Manifest;
  html: string | null;
  state: unknown;
  theme: "light" | "dark";
  shelf: Shelf;
}): Promise<string> {
  const libs = resolveLibs(input.manifest.libs);
  const scripts: string[] = [];
  for (const id of ["runtime-1", ...libs.map((lib) => lib.id)]) {
    const name = id === "runtime-1" ? "runtime-1.js" : shelfFile(id);
    const file = await input.shelf.get(name);
    if (!file) throw new Error(`Shelf file ${name} is missing.`);
    scripts.push(`<script src="${shelfUrl(name, file.hash)}"></script>`);
  }
  const boot = { miniId: input.miniId, state: input.state, theme: input.theme, tokens: null, entry: input.manifest.entry, html: input.html !== null };
  const head = [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<style>:root,.light{${tokenBlock(DEFAULT_TOKENS.light)}}.dark{${tokenBlock(DEFAULT_TOKENS.dark)}}</style>`,
    `<script>window.__miniBoot=${escapeJson(boot)};</script>`,
    ...scripts,
    `<style type="text/tailwindcss">${THEME_CSS}</style>`,
    `<script src="${appUrl(input.miniId, input.versionId)}"></script>`,
  ].join("\n");
  const htmlClass = `class="${input.theme}" style="color-scheme:${input.theme}"`;
  if (input.html === null) {
    return `<!doctype html>\n<html ${htmlClass}>\n<head>\n${head}\n</head>\n<body>\n<div id="root"></div>\n<script>__mini.run(${escapeJson(input.manifest.entry)});</script>\n</body>\n</html>\n`;
  }
  // An HTML entry keeps its own markup; the runtime goes first in its head.
  const html = input.html;
  const open = /<head\b[^>]*>/i.exec(html);
  if (open) return html.slice(0, open.index + open[0].length) + `\n${head}\n` + html.slice(open.index + open[0].length);
  const root = /<html\b[^>]*>/i.exec(html);
  if (root) return html.slice(0, root.index + root[0].length) + `\n<head>\n${head}\n</head>\n` + html.slice(root.index + root[0].length);
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)?.[0] ?? "";
  return `${doctype || "<!doctype html>"}\n<html ${htmlClass}>\n<head>\n${head}\n</head>\n<body>\n${html.slice(doctype.length)}\n</body>\n</html>\n`;
}

/**
 * The frame's CSP. `origin` is Studio's (scripts and the shelf come from it).
 * Images may also come from hosts the app is approved to fetch from.
 */
export function frameCsp(origin: string, granted: readonly string[]): string {
  const imageHosts = granted.filter((cap) => cap.startsWith("fetch:")).map((cap) => `https://${cap.slice(6)}`);
  return [
    "sandbox allow-scripts allow-forms allow-modals allow-downloads",
    "default-src 'none'",
    `script-src ${origin} 'unsafe-inline'`,
    `style-src ${origin} 'unsafe-inline'`,
    `img-src ${origin} data: blob: ${imageHosts.join(" ")}`.trim(),
    `font-src ${origin} data:`,
    "media-src data: blob:",
    "connect-src 'none'",
    "frame-src 'none'",
    "worker-src blob:",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}
