import { z } from "zod";

export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "A color is #rrggbb.");
export const THEME_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
export const themeId = z.string().regex(THEME_ID, "A theme id is lowercase letters, digits and dashes.");

export const SURFACES = ["sidebar", "main", "transcript", "composer", "hud"] as const;
export type Surface = (typeof SURFACES)[number];
export const TEXT_SURFACES = ["sidebar", "transcript", "composer", "hud"] as const satisfies readonly Surface[];
export const DEFAULT_MAIN_GLASS = { opacity: 0.18, blur: 0 } as const;
export const MODES = ["light", "dark"] as const;
export type Mode = (typeof MODES)[number];

const unit = z.number().min(0).max(1);
const fontStack = z.string().trim().min(1).max(240).regex(/^[A-Za-z0-9 ,"'\-_.]+$/, "A font stack is font names, quotes and commas.");

const headingWeight = z.number().int().min(100).max(900).refine((value) => value % 100 === 0, "A heading weight is 100, 200 … 900.");

const variant = z.object({
  canvas: hexColor,
  ink: hexColor,
  sidebar: hexColor,
  accent: hexColor,
  accentInk: hexColor,
  selection: hexColor,
  error: hexColor,
  warning: hexColor,
  success: hexColor,
});
export type ThemeVariant = z.infer<typeof variant>;

const glassSurface = z.object({ opacity: unit, blur: z.number().min(0).max(48) });
const glassModeSurfaces = z.object({ sidebar: glassSurface, main: glassSurface, transcript: glassSurface, composer: glassSurface, hud: glassSurface }).partial();
const glass = z.object({
  sidebar: glassSurface,
  main: glassSurface.default(DEFAULT_MAIN_GLASS),
  transcript: glassSurface,
  composer: glassSurface,
  hud: glassSurface,
  saturate: z.number().min(1).max(2),
  edge: hexColor.nullable(),
  modes: z.object({ light: glassModeSurfaces.optional(), dark: glassModeSurfaces.optional() }).optional(),
}).refine((value) => value.sidebar.opacity <= value.transcript.opacity && value.sidebar.opacity <= value.composer.opacity, "The sidebar's glass is lighter than the transcript's and the composer's.")
  .refine((value) => value.main.opacity <= value.transcript.opacity, "The main view's glass is lighter than the transcript's.");
export type ThemeGlass = z.infer<typeof glass>;

export const uniformName = z.string().regex(/^u_[a-zA-Z][a-zA-Z0-9]{0,30}$/, "A uniform is named u_ and letters or digits.");
const uniformValue = z.union([z.number().finite(), z.array(z.number().finite()).min(2).max(4), hexColor]);
export type UniformValue = z.infer<typeof uniformValue>;

const backdropRange = z.object({ dark: hexColor, light: hexColor });
const shaderScene = z.object({
  kind: z.literal("shader"),
  language: z.literal("glsl-es-100"),
  source: z.string().min(1).max(24_000),
  uniforms: z.record(uniformName, uniformValue),
  fallback: z.object({
    color: hexColor,
    image: z.string().regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, "A fallback image is a PNG, JPEG or WebP data URL.").max(400_000).nullable(),
  }),
  still: z.number().min(0).max(600),
  backdrop: backdropRange.extend({ modes: z.object({ light: backdropRange.optional(), dark: backdropRange.optional() }).optional() }),
});
export type ShaderScene = z.infer<typeof shaderScene>;
const scene = z.discriminatedUnion("kind", [z.object({ kind: z.literal("none") }), shaderScene]);

const effects = z.object({
  worker: z.object({ color: hexColor, character: z.string().trim().min(1).max(40) }),
  needsYou: z.object({ color: hexColor }),
  finished: z.object({ color: hexColor }),
  error: z.object({ color: hexColor }),
});

export const themePackageSchema = z.object({
  format: z.literal(1),
  id: themeId,
  name: z.string().trim().min(1).max(40),
  kind: z.enum(["scene", "classic"]),
  palette: z.tuple([hexColor, hexColor, hexColor, hexColor]),
  variants: z.object({ light: variant.optional(), dark: variant.optional() }).refine((value) => !!(value.light ?? value.dark), "A theme has a light or a dark variant."),
  glass: glass.nullable(),
  type: z.object({ heading: fontStack, body: fontStack, mono: fontStack, transcript: fontStack.optional(), headingWeight: headingWeight.optional() }),
  radius: z.number().min(0).max(16),
  motion: z.object({ speed: z.number().min(0).max(4), crossfadeMs: z.number().int().min(0).max(3000) }),
  effects,
  defaults: z.object({ intensity: unit, glass: unit, motion: unit }),
  scene,
  credit: z.object({
    source: z.string().regex(/^https:\/\/\S+$/, "A credit's source is an https URL."),
    license: z.string().trim().min(1).max(40),
    copyright: z.string().trim().min(1).max(200),
  }).nullable(),
}).superRefine((theme, ctx) => {
  if (theme.kind === "classic") {
    if (theme.scene.kind !== "none") ctx.addIssue({ code: "custom", path: ["scene"], message: "A classic theme has no scene." });
    if (theme.glass) ctx.addIssue({ code: "custom", path: ["glass"], message: "A classic theme has solid surfaces." });
    return;
  }
  if (theme.scene.kind !== "shader") ctx.addIssue({ code: "custom", path: ["scene"], message: "A scene theme has a shader." });
  if (!theme.glass) ctx.addIssue({ code: "custom", path: ["glass"], message: "A scene theme has glass." });
  if (theme.defaults.glass <= 0) ctx.addIssue({ code: "custom", path: ["defaults", "glass"], message: "A scene theme's glass starts above 0." });
  if (theme.defaults.motion <= 0) ctx.addIssue({ code: "custom", path: ["defaults", "motion"], message: "A scene theme's motion starts above 0." });
});
export type ThemePackage = z.infer<typeof themePackageSchema>;

export type ParsedTheme = { ok: true; theme: ThemePackage } | { ok: false; errors: string[] };

export function parseThemePackage(input: unknown): ParsedTheme {
  const parsed = themePackageSchema.safeParse(input);
  if (parsed.success) return { ok: true, theme: parsed.data };
  return { ok: false, errors: parsed.error.issues.map((issue) => (issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message)) };
}

export function variantFor(theme: Pick<ThemePackage, "variants">, appMode: Mode): { mode: Mode; colors: ThemeVariant } {
  const own = theme.variants[appMode];
  if (own) return { mode: appMode, colors: own };
  const other: Mode = appMode === "light" ? "dark" : "light";
  return { mode: other, colors: theme.variants[other]! };
}

export function glassSurfaceFor(theme: Pick<ThemePackage, "glass">, surface: Surface, mode?: Mode): { opacity: number; blur: number } | null {
  if (!theme.glass) return null;
  return (mode && theme.glass.modes?.[mode]?.[surface]) ?? theme.glass[surface];
}

export function themeModes(theme: Pick<ThemePackage, "variants">): Mode[] {
  return MODES.filter((mode) => !!theme.variants[mode]);
}
