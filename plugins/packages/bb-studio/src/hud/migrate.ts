// One-time: the HUD's shortcut used to default to Option+Space, which is the
// launcher's now. A stored HUD shortcut equal to that old default, or to the
// alternate Studio fell back to, was never really chosen for the HUD and
// would fight the launcher, so it is cleared once. A marker keeps a later,
// deliberate choice of the same keys.
import type { SettingsKv, StudioSettingsStore } from "../settings/store";

export const HUD_HOTKEY_MIGRATED_KEY = "settings:hudHotkeyCleared";
/** The old default and the old alternate, as Electron spells them. */
const OLD_HUD_HOTKEYS = ["alt+space", "alt+control+space"];

const KEY_NAMES: Record<string, string> = { option: "alt", ctrl: "control" };
const normal = (hotkey: string) => hotkey.split("+").map((part) => part.trim().toLowerCase()).filter(Boolean).map((part) => KEY_NAMES[part] ?? part).sort().join("+");

/** Clears a stored HUD shortcut that is the old default or alternate. Answers whether it cleared one. */
export async function clearOldHudHotkey(kv: SettingsKv, store: Pick<StudioSettingsStore, "explicit" | "set">): Promise<boolean> {
  if (await kv.get(HUD_HOTKEY_MIGRATED_KEY)) return false;
  const stored = store.explicit().hudHotkey;
  const old = typeof stored === "string" && OLD_HUD_HOTKEYS.includes(normal(stored));
  if (old) await store.set({ hudHotkey: null });
  await kv.set(HUD_HOTKEY_MIGRATED_KEY, { at: Date.now(), cleared: old });
  return old;
}
