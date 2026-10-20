// Studio's one OpenAI API key: Bot avatars (gpt-image) and voice calls
// (the Realtime API) both use it. It's a secret setting, so it stays on the
// server; it falls back to OPENAI_API_KEY on the BB host. Never log it, and
// never put it in an RPC answer.
//
// It replaces "Bot avatars: OpenAI API key" (botAvatarOpenaiApiKey). That
// setting stays defined so its stored value can still be read: while the new
// one is unset the old one counts, and migrateOpenaiKey copies it over once.

export const OPENAI_KEY_SETTING = "openaiApiKey";
/** The old, avatar-only setting. */
export const LEGACY_OPENAI_KEY_SETTING = "botAvatarOpenaiApiKey";

export const OPENAI_KEY_SETTINGS = {
  [OPENAI_KEY_SETTING]: { type: "string", label: "OpenAI API key", description: "Used for Bot avatars (gpt-image, about 1¢ an image) and voice calls with the Bot (the Realtime API). Stays on the BB server. Falls back to OPENAI_API_KEY on the BB host.", secret: true, default: "" },
  [LEGACY_OPENAI_KEY_SETTING]: { type: "string", label: "Bot avatars: OpenAI API key (moved)", description: "Replaced by OpenAI API key above. Studio copies a key from here into it and clears this one.", secret: true, default: "" },
} as const;

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** The key: the setting, then the old avatar setting, then OPENAI_API_KEY; "" when there's none. */
export function openaiKey(settings: Record<string, unknown> = {}, env: NodeJS.ProcessEnv = process.env): string {
  return text(settings[OPENAI_KEY_SETTING]) || text(settings[LEGACY_OPENAI_KEY_SETTING]) || text(env.OPENAI_API_KEY);
}

/**
 * Copies the old avatar key into the shared setting when only the old one is
 * set, and clears the old one. Returns whether it moved a key.
 */
export async function migrateOpenaiKey(settings: { get(): Promise<Record<string, unknown>>; set(values: Record<string, string | null>): Promise<unknown> }): Promise<boolean> {
  const values = await settings.get();
  const old = text(values[LEGACY_OPENAI_KEY_SETTING]);
  // Both set: the new one wins and the old one is left as it is.
  if (!old || text(values[OPENAI_KEY_SETTING])) return false;
  await settings.set({ [OPENAI_KEY_SETTING]: old, [LEGACY_OPENAI_KEY_SETTING]: null });
  return true;
}
