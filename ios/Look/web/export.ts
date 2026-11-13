// Run by ios/scripts/build-look.mjs under Node: resolves every theme's look with
// desktop's resolveLook and writes the colors the native views use (Shared/Look/looks.json).
import { writeFileSync } from "node:fs";
import { BUILTIN_DRIVERS } from "../../../plugins/packages/bb-studio/src/theme/builtin/drivers";
import { mixOklch, rgbToHex, type Rgb } from "../../../plugins/packages/bb-studio/src/theme/color";
import { resolveLook } from "../../../plugins/packages/bb-studio/src/theme/look";
import { BUILTIN_THEMES, SCENE_THEMES } from "../../../plugins/packages/bb-studio/src/theme/registry";
import { SURFACES, themeModes, type Mode, type ThemePackage } from "../../../plugins/packages/bb-studio/src/theme/schema";
import { presenceLook } from "../../../plugins/packages/bb-studio/src/presence/look";
import { paletteHex } from "../../../plugins/packages/bb-studio/src/presence/palette";
import { ON_AIR } from "./on-air";

const round = (value: number) => Math.round(value * 1000) / 1000;
const hex = (color: Rgb) => rgbToHex(color);

function tokens(theme: ThemePackage, mode: Mode) {
  const look = resolveLook(theme, theme.defaults, mode);
  const presence = presenceLook({ color: { source: "theme" } }, theme, mode);
  const per = (pick: (surface: (typeof SURFACES)[number]) => number) => Object.fromEntries(SURFACES.map((surface) => [surface, round(pick(surface))]));
  return {
    canvas: hex(look.canvas), ink: hex(look.ink), sidebar: hex(look.sidebar), accent: hex(look.accent), accentInk: hex(look.accentInk),
    selection: hex(look.selection), error: hex(look.error), warning: hex(look.warning), success: hex(look.success),
    worker: hex(look.worker), needsYou: hex(look.needsYou), finished: hex(look.finished), ripple: hex(look.ripple), sceneTone: hex(look.scene),
    muted: hex(mixOklch(look.ink, look.canvas, look.shares.muted)),
    subtle: hex(mixOklch(look.ink, look.canvas, look.shares.subtle)),
    errorText: hex(mixOklch(look.error, look.ink, look.shares.errorText)),
    warningText: hex(mixOklch(look.warning, look.ink, look.shares.warningText)),
    successText: hex(mixOklch(look.success, look.ink, look.shares.successText)),
    accentText: hex(mixOklch(look.accent, look.ink, look.shares.accentText)),
    selectionAlpha: round(look.shares.selection),
    alpha: per((surface) => look.alpha[surface]),
    blur: per((surface) => look.blur[surface]),
    saturate: round(look.saturate),
    edge: look.edge ? hex(look.edge) : null,
    halo: round(look.halo),
    radius: look.radius,
    presence: { palette: paletteHex(presence.palette), light: presence.light },
  };
}

function entry(theme: ThemePackage) {
  const modes = Object.fromEntries(themeModes(theme).map((mode) => [mode, tokens(theme, mode)]));
  const scene = theme.scene.kind === "shader"
    ? { still: theme.scene.still, fallback: theme.scene.fallback.color, fallbackImage: !!theme.scene.fallback.image, driver: !!BUILTIN_DRIVERS[theme.id], motion: theme.motion.speed }
    : null;
  return { id: theme.id, name: theme.name, kind: theme.kind, palette: theme.palette, modes, scene };
}

const themes = [ON_AIR, ...BUILTIN_THEMES].map(entry);
const out = { format: 1, defaultTheme: ON_AIR.id, scenes: SCENE_THEMES.map((theme) => theme.id), themes };
const target = process.argv[2];
if (!target) throw new Error("usage: export <out.json>");
writeFileSync(target, `${JSON.stringify(out, null, 1)}\n`);
