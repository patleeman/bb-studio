// The Background section is gone: bot and automation threads stay in their
// own sections, filtered per section. This carries the old global choice
// over once, as the `*` entry of `automatedThreads`, then drops the old keys.
import type { AutomatedThreadsMode } from "../../shared/preferences.js";

interface Kv {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<unknown>;
}

const OLD_KEYS = ["preference:backgroundThreads", "preference:backgroundCollapsed"] as const;
const NEW_KEY = "preference:automatedThreads";

/** Old Background choices as the new Automated threads modes. */
export function migratedAutomatedMode(old: unknown): AutomatedThreadsMode | null {
  if (old === "hidden") return "hidden";
  if (old === "all") return "all";
  // "grouped" and "updates" both kept results visible: the default.
  return null;
}

/** Returns the `*` mode it set, if any. Safe to run on every start. */
export async function migrateBackgroundPreference(kv: Kv): Promise<AutomatedThreadsMode | null> {
  const old = await kv.get<unknown>(OLD_KEYS[0]);
  const collapsed = await kv.get<unknown>(OLD_KEYS[1]);
  if (old === undefined && collapsed === undefined) return null;
  let mode = migratedAutomatedMode(old);
  if (mode) {
    const current = await kv.get<unknown>(NEW_KEY);
    const record = current && typeof current === "object" && !Array.isArray(current) ? current as Record<string, unknown> : {};
    // A choice made in the new menus wins over the old one.
    if ("*" in record) mode = null;
    else await kv.set(NEW_KEY, { ...record, "*": mode });
  }
  for (const key of OLD_KEYS) await kv.delete(key);
  return mode;
}
