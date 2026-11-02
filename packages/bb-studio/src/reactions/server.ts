// Reactions (built in; was the Studio Reactions plugin, `emoji-react`).
//
// Reactions keep no items, only settings: the emoji list shown on messages
// and where they show. They are Studio settings (src/settings), under the
// keys Reactions used. The frontend (./app.tsx) reads them once per frontend
// interpretation, so a change applies after a window reload.
//
// On start, Studio copies the old plugin's settings once if it's still
// installed: each value the user hasn't already changed in Studio.
import { pickSettings } from "../settings/schema";

/** The old plugin's id; its settings are read once, then it can be removed. */
export const REACTIONS_PLUGIN_ID = "emoji-react";
/** KV marker: the old plugin's settings were copied. */
export const REACTIONS_SETTINGS_IMPORTED = "reactions:settings-imported";

/** Reactions' Studio settings (src/settings/schema.ts, Agent replies). */
export const REACTIONS_SETTINGS = pickSettings(["emojiItems", "quoteSelection", "quotePosition", "showInSelectionMenu", "showInAssistantBar", "showInUserBar"]);

export interface ReactionsImportDeps {
  plugins: {
    list(): Promise<{ plugins: readonly { id: string }[] }>;
    getSettings(args: { pluginId: string; signal?: AbortSignal }): Promise<{ values: Record<string, unknown> }>;
  };
  kv: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> };
  settings: { get(): Promise<Record<string, unknown>>; set(values: Record<string, unknown>): Promise<unknown> };
}

/**
 * Copy the old Reactions plugin's settings into Studio, once. A key is
 * copied only when Studio still has its default (the user hasn't changed it
 * here) and the old value differs. Returns the keys copied, or null when
 * there was nothing to do (already copied, or the plugin isn't installed).
 */
export async function importReactionsSettings(deps: ReactionsImportDeps): Promise<string[] | null> {
  if (await deps.kv.get(REACTIONS_SETTINGS_IMPORTED)) return null;
  const { plugins } = await deps.plugins.list();
  if (!plugins.some((plugin) => plugin.id === REACTIONS_PLUGIN_ID)) return null;
  const { values } = await deps.plugins.getSettings({ pluginId: REACTIONS_PLUGIN_ID, signal: AbortSignal.timeout(10_000) });
  const current = await deps.settings.get();
  const next: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(REACTIONS_SETTINGS)) {
    const value = values[key];
    if (value === undefined || typeof value !== typeof def.default) continue;
    if (def.type === "select" && !(def.options as readonly unknown[]).includes(value)) continue;
    const mine = current[key] ?? def.default;
    if (mine !== def.default || value === mine) continue;
    next[key] = value;
  }
  const applied = Object.keys(next);
  if (applied.length) await deps.settings.set(next);
  await deps.kv.set(REACTIONS_SETTINGS_IMPORTED, { at: Date.now(), applied });
  return applied;
}
