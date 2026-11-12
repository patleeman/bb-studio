import { z } from "zod";
import { BUILTIN_FORMS, isBuiltinForm, type BuiltinForm } from "./forms";

export const PRESENCE_ID = /^[a-z][a-z0-9-]{1,39}$/;
export const MAX_CODE = 20_000;
export const MAX_MOTION = 2;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "A color is #rrggbb.");
export const presenceId = z.string().regex(PRESENCE_ID, "A presence id is lowercase letters, digits and dashes, 2 to 40 long.");

export const presenceColorSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("theme") }),
  z.object({ source: z.literal("custom"), hex: hexColor }),
]);
export type PresenceColor = z.infer<typeof presenceColorSchema>;

export const presenceSchema = z.object({
  form: presenceId,
  color: presenceColorSchema,
  motion: z.number().min(0).max(MAX_MOTION),
});
export type Presence = z.infer<typeof presenceSchema>;

export const presencePackageSchema = z.object({
  id: presenceId,
  name: z.string().trim().min(1).max(40),
  description: z.string().trim().max(200),
  code: z.string().min(1),
});
export type PresencePackage = z.infer<typeof presencePackageSchema>;

export const DEFAULT_FORMS: readonly BuiltinForm[] = ["tesseract", "orb", "poly"];
export const FALLBACK_FORM: BuiltinForm = "tesseract";

function hash(text: string): number {
  let value = 0;
  for (const char of text) value = (value * 31 + char.codePointAt(0)!) >>> 0;
  return value;
}

export function defaultForm(botId: string, primary = false): BuiltinForm {
  return primary ? FALLBACK_FORM : DEFAULT_FORMS[hash(botId) % DEFAULT_FORMS.length]!;
}

export function defaultPresence(botId: string, primary = false): Presence {
  return { form: defaultForm(botId, primary), color: { source: "theme" }, motion: 1 };
}

export function parsePresence(json: string | null | undefined, botId: string, primary = false): Presence {
  if (!json) return defaultPresence(botId, primary);
  try {
    const parsed = presenceSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : defaultPresence(botId, primary);
  } catch {
    return defaultPresence(botId, primary);
  }
}

export function samePresence(a: Presence, b: Presence): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function isBuiltinPresence(id: string): id is BuiltinForm {
  return isBuiltinForm(id);
}

export { BUILTIN_FORMS };
