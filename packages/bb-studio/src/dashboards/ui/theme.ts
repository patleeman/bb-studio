// BB's light or dark theme, as widgets see it: Dashboards' tiles and the
// canvas's items (src/canvas) share it.
import { useEffect, useMemo, useState } from "react";
import type { WidgetTheme } from "./custom-frame";

export function useDark(): boolean {
  const read = () => typeof document !== "undefined" && (document.documentElement.classList.contains("dark") || document.body.classList.contains("dark"));
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

/** BB's theme as a custom widget sees it. */
export function useWidgetTheme(): WidgetTheme {
  const dark = useDark();
  return useMemo(() => {
    const style = typeof document === "undefined" ? null : getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) => style?.getPropertyValue(name).trim() || fallback;
    return {
      mode: dark ? "dark" : "light",
      colors: {
        foreground: read("--foreground", dark ? "#f4f4f5" : "#18181b"),
        background: read("--background", dark ? "#09090b" : "#ffffff"),
        muted: read("--muted-foreground", dark ? "#a1a1aa" : "#71717a"),
        border: read("--border", dark ? "#27272a" : "#e4e4e7"),
        accent: read("--primary", "#6366f1"),
        series: ["#6366f1", "#14b8a6", "#f59e0b", "#ec4899", "#0ea5e9", "#84cc16", "#a855f7", "#ef4444"],
      },
    };
  }, [dark]);
}
