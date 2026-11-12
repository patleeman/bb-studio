// Bot avatars as app icons, so BB's own header button can draw one: a header
// action takes only an icon name (SDK 0.6.104), and icons are registered once
// at setup. Studio registers a few slots, `studio/bot-avatar-<n>`; the header
// (src/ui/thread-header.tsx) puts the Bots in them in list order and names
// the slot of the Bot whose chat is open. Past the last slot it's BB's Bot icon.
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { useSyncExternalStore } from "react";
import { BotFace } from "../../presence/ui/BotFace";

export const AVATAR_SLOTS = 8;
type Face = { id: string };

let faces: readonly (Face | undefined)[] = [];
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/** Puts `bots` in the slots, in order; redraws the icons only when a face changed. */
export function setAvatarSlots(bots: readonly Face[]): void {
  const next = bots.slice(0, AVATAR_SLOTS).map(({ id }) => ({ id }));
  if (JSON.stringify(next) === JSON.stringify(faces)) return;
  faces = next;
  for (const listener of listeners) listener();
}

/** The icon name for the Bot at `index` in the slots' order. */
export function avatarIcon(index: number): string {
  return index >= 0 && index < AVATAR_SLOTS ? `studio/bot-avatar-${index}` : "Bot";
}

function slotIcon(slot: number) {
  return function BotAvatarIcon({ className }: { className?: string }) {
    const face = useSyncExternalStore(subscribe, () => faces[slot], () => undefined);
    if (!face) return <svg viewBox="0 0 16 16" className={className} aria-hidden><circle cx="8" cy="8" r="6" fill="currentColor" opacity="0.3" /></svg>;
    return <BotFace botId={face.id} size={16} still className={className} />;
  };
}

export function registerBotAvatarIcons(app: PluginAppBuilder): void {

  for (let slot = 0; slot < AVATAR_SLOTS; slot++) app.experimental_icons.register({ name: avatarIcon(slot), component: slotIcon(slot) });
}
