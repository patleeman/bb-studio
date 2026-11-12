import { useMemo, useSyncExternalStore } from "react";
import { useLive } from "../../ui/live";
import { sameAppearance, type Appearance } from "../appearance";
import { createThemeRegistry, type ThemeRegistry } from "../registry";

export interface AppearanceDraft { botId: string; appearance: Appearance | null }
export interface AppearanceOverrides { draft: AppearanceDraft | null; saved: ReadonlyMap<string, Appearance | null> }

export const SAVED_HOLD_MS = 30_000;

let draft: AppearanceDraft | null = null;
let saved = new Map<string, { appearance: Appearance | null; timer: ReturnType<typeof setTimeout> }>();
let snapshot: AppearanceOverrides = { draft: null, saved: new Map() };
const listeners = new Set<() => void>();

function emit(): void {
  snapshot = { draft, saved: new Map([...saved].map(([botId, entry]) => [botId, entry.appearance])) };
  for (const listener of listeners) listener();
}

export function setAppearanceDraft(botId: string, appearance: Appearance | null, editing = true): void {
  const next = editing ? { botId, appearance } : null;
  if (!next && draft?.botId !== botId) return;
  draft = next;
  emit();
}

export function appearanceDraft(): AppearanceDraft | null {
  return draft;
}

export function markAppearanceSaved(botIds: readonly string[], appearance: Appearance | null): void {
  if (!botIds.length) return;
  const next = new Map(saved);
  for (const botId of botIds) {
    const old = next.get(botId);
    if (old) clearTimeout(old.timer);
    next.set(botId, { appearance, timer: setTimeout(() => forgetSavedAppearance([botId]), SAVED_HOLD_MS) });
  }
  saved = next;
  emit();
}

export function forgetSavedAppearance(botIds: readonly string[]): void {
  const gone = botIds.filter((botId) => saved.has(botId));
  if (!gone.length) return;
  const next = new Map(saved);
  for (const botId of gone) { clearTimeout(next.get(botId)!.timer); next.delete(botId); }
  saved = next;
  emit();
}

export function settleSavedAppearances(bots: readonly { id: string; appearance?: Appearance | null }[]): void {
  forgetSavedAppearance(bots.filter((bot) => saved.has(bot.id) && sameAppearance(saved.get(bot.id)!.appearance, bot.appearance ?? null)).map((bot) => bot.id));
}

export function appearanceOverrides(): AppearanceOverrides {
  return snapshot;
}

export function useAppearanceDraft(): AppearanceOverrides {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => snapshot, () => snapshot);
}

export function shownAppearance(bot: { id: string; appearance?: Appearance | null } | null | undefined, overrides: AppearanceOverrides): Appearance | null {
  if (!bot) return null;
  if (overrides.draft && overrides.draft.botId === bot.id) return overrides.draft.appearance;
  if (overrides.saved.has(bot.id)) return overrides.saved.get(bot.id) ?? null;
  return bot.appearance ?? null;
}

export function useThemeList() {
  return useLive("themes_list", {}, { pollMs: 0 });
}

export function useThemeRegistry(): ThemeRegistry {
  const themes = useThemeList().data?.themes;
  return useMemo(() => createThemeRegistry((themes ?? []).filter((entry) => entry.source === "stored").map((entry) => entry.theme)), [themes]);
}

