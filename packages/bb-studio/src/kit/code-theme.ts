// BB's theme in VS Code. The app reads BB's palette from the page (as hex),
// and the server writes it into each workspace's settings as
// workbench.colorCustomizations over VS Code's Modern theme of the same mode.
// Syntax colors stay the Modern theme's.
import { z } from "zod";

/** The BB CSS variables a workspace follows. */
export const BB_THEME_VARIABLES = [
  "background",
  "foreground",
  "sidebar",
  "border",
  "primary",
  "primary-foreground",
  "muted-foreground",
  "popover",
  "state-hover",
  "destructive",
  "warning",
  "success",
] as const;
export type BbThemeVariable = (typeof BB_THEME_VARIABLES)[number];

const hex = z.string().regex(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i);
export const bbThemeSchema = z.object({
  mode: z.enum(["dark", "light"]),
  colors: z.object(Object.fromEntries(BB_THEME_VARIABLES.map((name) => [name, hex])) as Record<BbThemeVariable, typeof hex>),
});
export type BbTheme = z.infer<typeof bbThemeSchema>;

export const BASE_THEME = { dark: "Dark Modern", light: "Light Modern" } as const;

/** `#rrggbb` with an alpha byte, for translucent selections and highlights. */
function alpha(color: string, amount: number): string {
  return `${color.slice(0, 7)}${Math.round(amount * 255).toString(16).padStart(2, "0")}`;
}

/** VS Code's workbench colors for a BB palette. */
export function vscodeColors({ colors: c }: BbTheme): Record<string, string> {
  const bg = c.background;
  const fg = c.foreground;
  const side = c.sidebar;
  const border = c.border;
  const accent = c.primary;
  const onAccent = c["primary-foreground"];
  const muted = c["muted-foreground"];
  const hover = c["state-hover"];
  const popover = c.popover;
  return {
    foreground: fg,
    descriptionForeground: muted,
    focusBorder: alpha(accent, 0.6),
    "widget.border": border,
    "sash.hoverBorder": accent,
    "textLink.foreground": accent,
    "textLink.activeForeground": accent,
    "progressBar.background": accent,
    "button.background": accent,
    "button.foreground": onAccent,
    "button.hoverBackground": accent,
    "badge.background": accent,
    "badge.foreground": onAccent,

    "editor.background": bg,
    "editor.foreground": fg,
    "editorGutter.background": bg,
    "editorCursor.foreground": accent,
    "editor.lineHighlightBackground": hover,
    "editor.lineHighlightBorder": "#00000000",
    "editor.selectionBackground": alpha(accent, 0.3),
    "editor.inactiveSelectionBackground": alpha(accent, 0.18),
    "editorLineNumber.foreground": alpha(muted, 0.55),
    "editorLineNumber.activeForeground": fg,
    "editorStickyScroll.background": bg,
    "breadcrumb.background": bg,
    "editorWidget.background": popover,
    "editorWidget.border": border,
    "editorHoverWidget.background": popover,
    "editorHoverWidget.border": border,
    "editorSuggestWidget.background": popover,
    "editorSuggestWidget.border": border,
    "editorGroup.border": border,
    "editorGroupHeader.tabsBackground": side,
    "editorGroupHeader.tabsBorder": border,

    "tab.activeBackground": bg,
    "tab.activeForeground": fg,
    "tab.activeBorderTop": accent,
    "tab.inactiveBackground": side,
    "tab.inactiveForeground": muted,
    "tab.hoverBackground": hover,
    "tab.border": border,

    "titleBar.activeBackground": bg,
    "titleBar.activeForeground": fg,
    "titleBar.inactiveBackground": bg,
    "titleBar.inactiveForeground": muted,
    "titleBar.border": border,

    "activityBar.background": side,
    "activityBar.foreground": fg,
    "activityBar.inactiveForeground": muted,
    "activityBar.border": border,
    "activityBar.activeBorder": accent,
    "activityBarBadge.background": accent,
    "activityBarBadge.foreground": onAccent,

    "sideBar.background": side,
    "sideBar.foreground": fg,
    "sideBar.border": border,
    "sideBarTitle.foreground": fg,
    "sideBarSectionHeader.background": side,
    "sideBarSectionHeader.foreground": fg,
    "sideBarSectionHeader.border": border,

    "list.hoverBackground": hover,
    "list.activeSelectionBackground": alpha(accent, 0.22),
    "list.activeSelectionForeground": fg,
    "list.inactiveSelectionBackground": hover,
    "list.focusOutline": alpha(accent, 0.6),
    "list.highlightForeground": accent,

    "statusBar.background": side,
    "statusBar.foreground": muted,
    "statusBar.border": border,
    "statusBar.noFolderBackground": side,
    "statusBar.debuggingBackground": accent,
    "statusBar.debuggingForeground": onAccent,
    "statusBarItem.hoverBackground": hover,
    "statusBarItem.remoteBackground": side,
    "statusBarItem.remoteForeground": muted,

    "panel.background": bg,
    "panel.border": border,
    "panelTitle.activeBorder": accent,
    "panelTitle.activeForeground": fg,
    "panelTitle.inactiveForeground": muted,
    "terminal.background": bg,
    "terminal.foreground": fg,
    "terminalCursor.foreground": accent,

    "input.background": bg,
    "input.foreground": fg,
    "input.border": border,
    "input.placeholderForeground": alpha(muted, 0.7),
    "dropdown.background": popover,
    "dropdown.border": border,
    "dropdown.foreground": fg,
    "quickInput.background": popover,
    "quickInput.foreground": fg,
    "menu.background": popover,
    "menu.foreground": fg,
    "menu.border": border,
    "menu.selectionBackground": hover,
    "menu.selectionForeground": fg,
    "notifications.background": popover,
    "notifications.border": border,
    "scrollbarSlider.background": alpha(muted, 0.18),
    "scrollbarSlider.hoverBackground": alpha(muted, 0.3),
    "scrollbarSlider.activeBackground": alpha(muted, 0.4),

    "gitDecoration.modifiedResourceForeground": c.warning,
    "gitDecoration.addedResourceForeground": c.success,
    "gitDecoration.untrackedResourceForeground": c.success,
    "gitDecoration.deletedResourceForeground": c.destructive,
    "errorForeground": c.destructive,
    "editorError.foreground": c.destructive,
    "editorWarning.foreground": c.warning,
  };
}

/** The settings a theme sets; everything else in settings.json is the user's. */
export function themeSettings(theme: BbTheme): Record<string, unknown> {
  return {
    "workbench.colorTheme": BASE_THEME[theme.mode],
    "window.autoDetectColorScheme": false,
    "workbench.colorCustomizations": vscodeColors(theme),
  };
}
