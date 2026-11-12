import { variantFor, type Mode, type ThemePackage } from "../theme/schema";
import type { Palette } from "./forms";
import { DEFAULT_PALETTE, DEFAULT_PALETTE_LIGHT, hexToTriple, paletteFromColor, paletteFromTheme } from "./palette";
import type { Presence } from "./schema";

export interface PresenceLook { palette: Palette; light: boolean }

export function presenceLook(presence: Pick<Presence, "color">, theme: Pick<ThemePackage, "palette" | "variants"> | null, mode: Mode): PresenceLook {
  const variant = theme ? variantFor(theme, mode) : null;
  const light = (variant?.mode ?? mode) === "light";
  if (presence.color.source === "custom") return { palette: paletteFromColor(hexToTriple(presence.color.hex), light), light };
  if (!theme || !variant) return { palette: light ? DEFAULT_PALETTE_LIGHT : DEFAULT_PALETTE, light };
  return { palette: paletteFromTheme([variant.colors.canvas, variant.colors.accent, theme.palette[1], theme.palette[2]]), light };
}
