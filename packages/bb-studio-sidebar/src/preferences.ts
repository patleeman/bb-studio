// The list's synced preferences. Stored under the same `preference:<key>` kv
// keys the earlier, multi-mode Studio Sidebar used, so existing values carry over.
import { z } from "zod";

const idSchema = z.string().min(1).max(1_024);
const idListSchema = z.array(idSchema).max(10_000).transform((value) => [...new Set(value)]);

export const preferenceSchemas = {
  currentSpace: idSchema.nullable(),
  hiddenThreads: idListSchema,
  collapsedThreads: idListSchema,
  collapsedSpaces: idListSchema,
} as const;

export type PreferenceKey = keyof typeof preferenceSchemas;
export type Preferences = { [Key in PreferenceKey]: z.infer<(typeof preferenceSchemas)[Key]> };
export const PREFERENCE_KEYS = Object.keys(preferenceSchemas) as PreferenceKey[];

export const DEFAULT_PREFERENCES: Preferences = {
  currentSpace: null,
  hiddenThreads: [],
  collapsedThreads: [],
  collapsedSpaces: [],
};

export const PREFERENCE_DESCRIPTIONS: Record<PreferenceKey, string> = {
  currentSpace: "The Space the list shows: a Space id, \"all\" for every Space, or null for the default Space.",
  hiddenThreads: "Thread ids hidden from their Space unless pinned, open, or a lead.",
  collapsedThreads: "Thread ids whose sub-threads are folded away.",
  collapsedSpaces: "Space ids collapsed in the All view.",
};

/**
 * The list only organizes by Space. `organizationMode` is still reported, read
 * only, for clients (Studio, the iOS app) that ask which mode the sidebar is in.
 */
export const ORGANIZATION_MODE = "space";

export const PREFERENCES_CHANGED_CHANNEL = "preferences";

export function isPreferenceKey(value: string): value is PreferenceKey {
  return Object.hasOwn(preferenceSchemas, value);
}

export function parsePreference<Key extends PreferenceKey>(key: Key, value: unknown):
  | { success: true; value: Preferences[Key] }
  | { success: false; message: string } {
  const parsed = (preferenceSchemas[key] as z.ZodTypeAny).safeParse(value);
  return parsed.success
    ? { success: true, value: parsed.data as Preferences[Key] }
    : { success: false, message: parsed.error.issues.map((issue) => issue.message).join("; ") };
}
