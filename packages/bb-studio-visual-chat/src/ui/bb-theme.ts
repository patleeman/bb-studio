// BB's live theme in the page: its theme tokens (theme.ts) read from the
// CSS variables BB gives plugin UI, and read again whenever BB's theme
// changes: light or dark (a class on <html>), a palette switch or preview (a
// stylesheet BB rewrites in <head>), or a custom palette. One shared store:
// every board, frame and card reads the same theme, and one observer watches.
import { useSyncExternalStore } from "react";
import { BB_COLOR_VARS, bbTheme, defaultBbTheme, sameTheme, type BbColor, type BbTheme, type Mode } from "../theme";

/** Where a theme comes from: a read, and a way to hear that it may have changed. */
export interface ThemeSource {
  read(): BbTheme;
  watch(changed: () => void): () => void;
}

/** A store over a source: the current theme, kept the same object until it really changes. */
export function createThemeStore(source: ThemeSource) {
  let current: BbTheme | null = null;
  const listeners = new Set<() => void>();
  let stop: (() => void) | null = null;
  const refresh = () => {
    const next = source.read();
    // Nobody has read it yet: nothing to tell.
    if (!current) { current = next; return; }
    if (sameTheme(current, next)) return;
    current = next;
    for (const listener of [...listeners]) listener();
  };
  return {
    get(): BbTheme {
      if (!current) current = source.read();
      return current;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      if (!stop) stop = source.watch(refresh);
      // A change between the first read and the subscription isn't missed.
      refresh();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && stop) { stop(); stop = null; }
      };
    },
    refresh,
  };
}
export type ThemeStore = ReturnType<typeof createThemeStore>;

const isDark = (doc: Document) => doc.documentElement.classList.contains("dark") || doc.body?.classList.contains("dark") === true;

/** A canvas 2D context, to turn any CSS color the page resolves into sRGB bytes. */
let paint: CanvasRenderingContext2D | null | undefined;
function toRgbString(color: string): string | null {
  if (paint === undefined) {
    try { paint = document.createElement("canvas").getContext("2d", { willReadFrequently: true }); } catch { paint = null; }
  }
  if (!paint) return null;
  paint.clearRect(0, 0, 1, 1);
  paint.fillStyle = "#000";
  paint.fillStyle = color;
  paint.fillRect(0, 0, 1, 1);
  const [r, g, b] = paint.getImageData(0, 0, 1, 1).data;
  return `rgb(${r} ${g} ${b})`;
}

/** BB's theme as this document has it now. */
export function readDocumentTheme(doc: Document = document): BbTheme {
  const mode: Mode = isDark(doc) ? "dark" : "light";
  if (!doc.body) return defaultBbTheme(mode);
  // A probe resolves each variable the way the page paints it (color-mix, oklch, var chains).
  const probe = doc.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:fixed;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none";
  doc.body.appendChild(probe);
  try {
    const root = getComputedStyle(doc.documentElement);
    const colors: Partial<Record<BbColor, string>> = {};
    for (const [key, name] of Object.entries(BB_COLOR_VARS) as [BbColor, string][]) {
      // Not set: BB's default stands in (bbTheme).
      if (root.getPropertyValue(name).trim() === "") continue;
      probe.style.color = `var(${name})`;
      const resolved = getComputedStyle(probe).color;
      colors[key] = toRgbString(resolved) ?? resolved;
    }
    const font = (name: string) => root.getPropertyValue(name).trim() || undefined;
    probe.style.width = "var(--radius)";
    const radius = Number.parseFloat(getComputedStyle(probe).width);
    return bbTheme(mode, { colors, fonts: { sans: font("--font-sans"), serif: font("--font-serif"), mono: font("--font-mono") }, radius: root.getPropertyValue("--radius").trim() ? radius : null });
  } finally {
    probe.remove();
  }
}

/** The page as a theme source: <html>'s and <body>'s classes and styles, and BB's stylesheets in <head>. */
export function documentThemeSource(doc: Document = document): ThemeSource {
  return {
    read: () => readDocumentTheme(doc),
    watch(changed) {
      let queued = false;
      // A palette switch rewrites a <style> and flips classes in one go: read once after it settles.
      const later = () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; changed(); });
      };
      const observer = new MutationObserver(later);
      observer.observe(doc.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
      if (doc.body) observer.observe(doc.body, { attributes: true, attributeFilter: ["class", "style"] });
      observer.observe(doc.head, { childList: true, subtree: true, characterData: true });
      const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
      media?.addEventListener("change", later);
      return () => { observer.disconnect(); media?.removeEventListener("change", later); };
    },
  };
}

let shared: ThemeStore | null = null;
const store = () => (shared ??= createThemeStore(documentThemeSource()));

/** BB's theme, live. */
export function useBbTheme(): BbTheme {
  const s = store();
  return useSyncExternalStore(s.subscribe, s.get, s.get);
}
