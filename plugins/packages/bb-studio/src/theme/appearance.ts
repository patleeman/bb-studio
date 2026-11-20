import { z } from "zod";
import { canonicalThemeId, DEFAULT_THEME_ID, type ThemeRegistry } from "./registry";
import { themeId, type ThemePackage } from "./schema";

const unit = z.number().min(0).max(1);

export const EFFECTS = ["workers", "finished", "needsYou", "error"] as const;
export type EffectSwitch = (typeof EFFECTS)[number];

export const appearanceSchema = z.object({
  themeId,
  intensity: unit,
  glass: unit,
  motion: unit,
  effects: z.object({ workers: z.boolean(), finished: z.boolean(), needsYou: z.boolean(), error: z.boolean() }),
});
export type Appearance = z.infer<typeof appearanceSchema>;

export function defaultAppearance(theme: Pick<ThemePackage, "id" | "defaults" | "kind">): Appearance {
  const scene = theme.kind === "scene";
  return {
    themeId: theme.id,
    intensity: theme.defaults.intensity,
    glass: theme.defaults.glass,
    motion: theme.defaults.motion,
    effects: { workers: scene, finished: scene, needsYou: true, error: scene },
  };
}

export function withTheme(current: Appearance | null, theme: Pick<ThemePackage, "id" | "defaults" | "kind">): Appearance {
  const fresh = defaultAppearance(theme);
  return current ? { ...fresh, effects: { ...current.effects } } : fresh;
}

/** What a Bot shows: its theme, or the default theme when its own is gone, and which id went missing. */
export interface ResolvedTheme { theme: ThemePackage | null; appearance: Appearance | null; missing: string | null }

/**
 * The theme an appearance shows. A theme id the registry no longer has (a
 * custom theme deleted or made invalid) shows the default theme instead and
 * names the missing id, so the picker can say why. While stored themes are
 * still loading, nothing is shown yet rather than a false "gone".
 */
export function resolveTheme(registry: Pick<ThemeRegistry, "get" | "ready">, appearance: Appearance | null): ResolvedTheme {
  if (!appearance) return { theme: null, appearance: null, missing: null };
  const theme = registry.get(appearance.themeId);
  if (theme) return { theme, appearance, missing: null };
  if (registry.ready === false) return { theme: null, appearance: null, missing: null };
  const fallback = registry.get(DEFAULT_THEME_ID);
  return { theme: fallback, appearance: fallback ? withTheme(appearance, fallback) : null, missing: appearance.themeId };
}

/** The picker's plain note for a theme that is gone. */
export function missingThemeNote(themeId: string): string {
  return `The theme "${themeId}" is gone; showing the default. Pick another.`;
}

export function parseAppearance(json: string | null | undefined): Appearance | null {
  if (!json) return null;
  try {
    const parsed = appearanceSchema.safeParse(JSON.parse(json));
    return parsed.success ? { ...parsed.data, themeId: canonicalThemeId(parsed.data.themeId) } : null;
  } catch {
    return null;
  }
}

export function sameAppearance(a: Appearance | null, b: Appearance | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
