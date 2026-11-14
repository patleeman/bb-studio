// Studio's one OpenAI API key: hands-free voice (GPT-Live and the Realtime
// API) uses it. It stays secret on the server and
// falls back to the OPENAI_API_KEY environment variable. Never log it, and never put it
// in an RPC answer: voice clients get at most a 2-minute Realtime secret.
//
// It replaced "Bot avatars: OpenAI API key" (botAvatarOpenaiApiKey). That
// setting is gone: the settings migration (src/settings/migrate.ts) copies
// its key here when this one is empty, and clears it either way.

export const OPENAI_KEY_SETTING = "openaiApiKey";
/** The old, avatar-only setting; only the migration still names it. */
export const LEGACY_OPENAI_KEY_SETTING = "botAvatarOpenaiApiKey";

export const OPENAI_KEY_SETTINGS = {
  [OPENAI_KEY_SETTING]: { type: "string", label: "OpenAI API key", description: "Hands-free voice. If empty, Studio uses the OPENAI_API_KEY environment variable.", secret: true, default: "" },
} as const;

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** The key: the setting, then OPENAI_API_KEY; "" when there's none. */
export function openaiKey(settings: Record<string, unknown> = {}, env: NodeJS.ProcessEnv = process.env): string {
  return text(settings[OPENAI_KEY_SETTING]) || text(env.OPENAI_API_KEY);
}

/**
 * The OpenAI part of the settings migration: the old avatar key moves into
 * the shared setting when that one is empty, and is cleared either way. The
 * values are never returned or logged; only what happened.
 */
export function openaiKeyMigration(values: Record<string, unknown>): { patch: Record<string, string | null>; outcome: "none" | "copied" | "cleared" } {
  const old = text(values[LEGACY_OPENAI_KEY_SETTING]);
  if (!old) return { patch: {}, outcome: "none" };
  if (text(values[OPENAI_KEY_SETTING])) return { patch: { [LEGACY_OPENAI_KEY_SETTING]: null }, outcome: "cleared" };
  return { patch: { [OPENAI_KEY_SETTING]: old, [LEGACY_OPENAI_KEY_SETTING]: null }, outcome: "copied" };
}
