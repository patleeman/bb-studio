import { z } from "zod";
import { canonicalThemeId } from "./registry";
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
