import { AURORA_FJORD } from "./builtin/aurora-fjord";
import { CLASSIC_THEMES } from "./builtin/classic";
import { DATA_CITY } from "./builtin/data-city";
import { DEEP_SEA } from "./builtin/deep-sea";
import { EVENT_HORIZON } from "./builtin/event-horizon";
import { FOREST } from "./builtin/forest";
import { GRID } from "./builtin/grid";
import { KYOTO_GARDEN } from "./builtin/kyoto-garden";
import { MIAMI } from "./builtin/miami";
import { TONIGHTS_SKY } from "./builtin/tonights-sky";
import { parseThemePackage, type ThemePackage } from "./schema";

export type ThemeSource = "builtin" | "stored";
export interface ThemeEntry { theme: ThemePackage; source: ThemeSource }

export const SCENE_THEMES: readonly ThemePackage[] = [MIAMI, EVENT_HORIZON, GRID, KYOTO_GARDEN, FOREST, AURORA_FJORD, TONIGHTS_SKY, DATA_CITY, DEEP_SEA];
export const BUILTIN_THEMES: readonly ThemePackage[] = [...SCENE_THEMES, ...CLASSIC_THEMES];
export const DEFAULT_THEME_ID = "bb-default";

export const THEME_ALIASES: Readonly<Record<string, string>> = { "cabin-aurora": "aurora-fjord", "zen-garden": "kyoto-garden" };
export function canonicalThemeId(id: string): string {
  return THEME_ALIASES[id] ?? id;
}

const BUILTIN_IDS = new Set(BUILTIN_THEMES.map((theme) => theme.id));
export function isBuiltinTheme(id: string): boolean {
  return BUILTIN_IDS.has(canonicalThemeId(id));
}

export interface ThemeRegistry {
  list(): ThemeEntry[];
  get(id: string): ThemePackage | null;
  scenes(): ThemeEntry[];
  classics(): ThemeEntry[];
}

export function createThemeRegistry(stored: readonly unknown[] = []): ThemeRegistry {
  const entries: ThemeEntry[] = BUILTIN_THEMES.map((theme) => ({ theme, source: "builtin" }));
  for (const each of stored) {
    const parsed = parseThemePackage(each);
    if (parsed.ok && !isBuiltinTheme(parsed.theme.id) && !entries.some((entry) => entry.theme.id === parsed.theme.id)) entries.push({ theme: parsed.theme, source: "stored" });
  }
  const byId = new Map(entries.map((entry) => [entry.theme.id, entry.theme]));
  return {
    list: () => entries.slice(),
    get: (id) => byId.get(canonicalThemeId(id)) ?? null,
    scenes: () => entries.filter((entry) => entry.theme.kind === "scene"),
    classics: () => entries.filter((entry) => entry.theme.kind === "classic"),
  };
}
