import { useSyncExternalStore } from "react";
import { sameAppearance, withTheme, type Appearance } from "../appearance";
import type { ThemeRegistry } from "../registry";
import type { ThemePackage } from "../schema";
import { appearanceOverrides, forgetSavedAppearance, markAppearanceSaved, shownAppearance } from "./state";

export const NONE_ID = "none";
export const NONE_NAME = "None";
export const THEME_NEXT_COMMAND = "theme-next";
export const THEME_PREVIOUS_COMMAND = "theme-previous";

export interface ThemeChoice { id: string | null; name: string; group: "scene" | "classic"; custom: boolean; theme: ThemePackage | null }
export interface QuickBot { id: string; appearance?: Appearance | null }
export type SaveAppearance = (botId: string, appearance: Appearance | null) => Promise<unknown>;

const NONE: ThemeChoice = { id: null, name: NONE_NAME, group: "classic", custom: false, theme: null };

export function themeChoices(registry: ThemeRegistry): ThemeChoice[] {
  const choice = (group: ThemeChoice["group"]) => ({ theme, source }: { theme: ThemePackage; source: string }): ThemeChoice => ({ id: theme.id, name: theme.name, group, custom: source === "stored", theme });
  return [...registry.scenes().map(choice("scene")), ...registry.classics().map(choice("classic")), NONE];
}

export function popoverGroups(choices: readonly ThemeChoice[]): { label: "Scene" | "Classic"; choices: ThemeChoice[] }[] {
  const classic = choices.filter((each) => each.group === "classic");
  return [
    { label: "Scene", choices: choices.filter((each) => each.group === "scene") },
    { label: "Classic", choices: [...classic.filter((each) => each.id === null), ...classic.filter((each) => each.id !== null)] },
  ];
}

export function appearanceFor(current: Appearance | null, theme: ThemePackage | null): Appearance | null {
  if (!theme) return null;
  return current && current.themeId === theme.id ? current : withTheme(current, theme);
}

export function appliedAppearance(bot: QuickBot): Appearance | null {
  return shownAppearance(bot, { draft: null, saved: appearanceOverrides().saved });
}

export function cycledChoice(choices: readonly ThemeChoice[], currentId: string | null, step: 1 | -1): ThemeChoice | null {
  if (!choices.length) return null;
  const at = choices.findIndex((each) => each.id === currentId);
  if (at < 0) return choices[step > 0 ? 0 : choices.length - 1]!;
  return choices[(at + step + choices.length) % choices.length]!;
}

export interface SaveThemeInput { bot: QuickBot; themeId: string | null; registry: ThemeRegistry; save: SaveAppearance }

export async function saveTheme({ bot, themeId, registry, save }: SaveThemeInput): Promise<boolean> {
  const theme = themeId === null ? null : registry.get(themeId);
  if (themeId !== null && !theme) return false;
  const current = appliedAppearance(bot);
  const next = appearanceFor(current, theme);
  if (sameAppearance(current, next)) return true;
  markAppearanceSaved([bot.id], next);
  try {
    await save(bot.id, next);
  } catch (cause) {
    forgetSavedAppearance([bot.id]);
    throw cause;
  }
  return true;
}

export interface ThemeQuickRuntime { bots: readonly QuickBot[]; shownBotId: string | null; registry: ThemeRegistry; save: SaveAppearance }

let runtime: ThemeQuickRuntime | null = null;

export function setThemeQuickRuntime(next: ThemeQuickRuntime | null): void {
  runtime = next;
}

function shown(): QuickBot | null {
  return runtime?.bots.find((bot) => bot.id === runtime?.shownBotId) ?? null;
}

export function canSwitchTheme(): boolean {
  return !!shown();
}

export function shownBotThemeChoices(): ThemeChoice[] {
  return runtime && shown() ? themeChoices(runtime.registry) : [];
}

export async function applyThemeToShownBot(themeId: string | null): Promise<boolean> {
  const bot = shown();
  if (!runtime || !bot) return false;
  return saveTheme({ bot, themeId, registry: runtime.registry, save: runtime.save });
}

export async function cycleTheme(step: 1 | -1): Promise<boolean> {
  const bot = shown();
  if (!runtime || !bot) return false;
  const next = cycledChoice(themeChoices(runtime.registry), appliedAppearance(bot)?.themeId ?? null, step);
  return next ? saveTheme({ bot, themeId: next.id, registry: runtime.registry, save: runtime.save }) : false;
}

export interface ThemeCommandRegistration {
  id: string;
  title: string;
  defaultShortcut: { key: string; control: true; alt: true; shift?: true };
  isAvailable(): boolean;
  run(): Promise<void>;
}

export function themeCommandRegistrations(): ThemeCommandRegistration[] {
  return [
    { id: THEME_NEXT_COMMAND, title: "Studio: Next theme", defaultShortcut: { key: "t", control: true, alt: true }, isAvailable: canSwitchTheme, run: async () => { await cycleTheme(1); } },
    { id: THEME_PREVIOUS_COMMAND, title: "Studio: Previous theme", defaultShortcut: { key: "t", control: true, alt: true, shift: true }, isAvailable: canSwitchTheme, run: async () => { await cycleTheme(-1); } },
  ];
}

let open = false;
const listeners = new Set<() => void>();

export function setThemePopoverOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  for (const listener of listeners) listener();
}

export function toggleThemePopover(): void {
  setThemePopoverOpen(!open);
}

export function useThemePopoverOpen(): boolean {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => open, () => false);
}

export const POPOVER_COLUMNS = 3;
export type GridKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

export function isGridKey(key: string): key is GridKey {
  return key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown";
}

export function gridMove(sizes: readonly number[], index: number, key: GridKey, columns: number = POPOVER_COLUMNS): number {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (!total) return 0;
  if (key === "ArrowLeft") return Math.max(0, index - 1);
  if (key === "ArrowRight") return Math.min(total - 1, index + 1);
  const starts = sizes.map((_, at) => sizes.slice(0, at).reduce((sum, size) => sum + size, 0));
  const group = Math.max(0, sizes.findIndex((size, at) => index >= starts[at]! && index < starts[at]! + size));
  const offset = index - starts[group]!;
  const size = sizes[group]!;
  const column = offset % columns;
  if (key === "ArrowDown") {
    if (offset + columns < size) return index + columns;
    if (Math.floor(offset / columns) < Math.floor((size - 1) / columns)) return starts[group]! + size - 1;
    const next = sizes.findIndex((each, at) => at > group && each > 0);
    return next < 0 ? index : starts[next]! + Math.min(column, sizes[next]! - 1);
  }
  if (offset - columns >= 0) return index - columns;
  let before = -1;
  for (let at = group - 1; at >= 0; at--) if (sizes[at]! > 0) { before = at; break; }
  if (before < 0) return index;
  const lastRow = Math.floor((sizes[before]! - 1) / columns) * columns;
  return starts[before]! + Math.min(lastRow + column, sizes[before]! - 1);
}
