import type { CodeContract } from "./contract";
// Sends BB's palette to the server whenever BB's theme or mode changes, so
// open and future workspaces match it. Colors are read from the page, so
// custom and plugin themes work too; a canvas turns oklch() and
// color-mix() into the hex VS Code needs.
import { useEffect } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";

import { hostTheme, subscribeHostTheme } from "../kit/app/host-theme";
import { BB_THEME_VARIABLES, type BbTheme, type BbThemeVariable } from "./theme";

/** For a theme that leaves a variable out. */
const FALLBACK: Partial<Record<BbThemeVariable, string>> = {
  sidebar: "var(--background)",
  popover: "var(--background)",
  border: "color-mix(in oklch, var(--foreground) 15%, var(--background))",
  "muted-foreground": "var(--foreground)",
  "primary-foreground": "#ffffff",
  "state-hover": "color-mix(in oklch, var(--foreground) 7%, transparent)",
  warning: "#d29922",
  success: "#3fb950",
  destructive: "#f85149",
};

function hexOf(context: CanvasRenderingContext2D, color: string): string | null {
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = "#000000";
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
  if (a === undefined || a === 0) return null;
  const part = (value: number) => value.toString(16).padStart(2, "0");
  return `#${part(r!)}${part(g!)}${part(b!)}${a < 255 ? part(a) : ""}`;
}

/** BB's palette as hex, or null where the page has no theme to read. */
export function readBbTheme(): BbTheme | null {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  const probe = document.createElement("span");
  probe.style.display = "none";
  document.body.appendChild(probe);
  try {
    const colors = {} as Record<BbThemeVariable, string>;
    for (const name of BB_THEME_VARIABLES) {
      probe.style.color = "";
      probe.style.color = `var(--${name}${FALLBACK[name] ? `, ${FALLBACK[name]}` : ""})`;
      const color = hexOf(context, getComputedStyle(probe).color);
      if (!color) return null;
      colors[name] = color;
    }
    const root = document.documentElement.classList;
    const mode = root.contains("dark") ? "dark" : root.contains("light") ? "light" : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    return { mode, colors };
  } finally {
    probe.remove();
  }
}

let lastSent = "";
/**
 * Open editors take BB's new colors over the bridge and restyle in place.
 * Only an editor started before it could do that reloads; views listen here
 * for that.
 */
export const themeChanges = new EventTarget();

/** Keeps the server's copy of BB's theme current while a workspace is on screen. */
export function useThemeSync(enabled: boolean): void {
  const rpc = useRpc<CodeContract>();
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sync = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const theme = readBbTheme();
        const key = theme ? JSON.stringify(theme) : "";
        if (!theme || key === lastSent) return;
        // A change this page saw, or one the server hadn't heard of yet.
        const seen = lastSent !== "";
        lastSent = key;
        rpc.call("code.syncTheme", theme).then(
          ({ changed, reload }) => { if ((seen || changed) && reload) themeChanges.dispatchEvent(new Event("change")); },
          () => { lastSent = ""; },
        );
      }, 250);
    };
    sync();
    // BB says when its theme changes, where it can; the effect below it
    // runs after BB has applied the new variables.
    if (hostTheme()) {
      const unsubscribe = subscribeHostTheme(sync);
      return () => { clearTimeout(timer); unsubscribe(); };
    }
    // Mode is a class on <html>; themes arrive as <style> in <head>.
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", sync);
    return () => { clearTimeout(timer); observer.disconnect(); scheme.removeEventListener("change", sync); };
  }, [enabled, rpc]);
}
