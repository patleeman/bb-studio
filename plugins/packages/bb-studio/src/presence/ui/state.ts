import { useMemo, useSyncExternalStore } from "react";
import { useLive } from "../../ui/live";
import type { PresenceEntryView } from "../contract";
import { defaultPresence, type Presence } from "../schema";

export interface PresenceDraft { botId: string; presence: Presence }

let draft: PresenceDraft | null = null;
const failed = new Map<string, string>();
let version = 0;
const listeners = new Set<() => void>();

function emit(): void {
  version++;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function setPresenceDraft(botId: string, presence: Presence | null): void {
  if (!presence && draft?.botId !== botId) return;
  draft = presence ? { botId, presence } : null;
  emit();
}

export const SAVED_HOLD_MS = 30_000;
const saved = new Map<string, { presence: Presence; timer: ReturnType<typeof setTimeout> }>();

export function markPresenceSaved(botId: string, presence: Presence): void {
  const old = saved.get(botId);
  if (old) clearTimeout(old.timer);
  saved.set(botId, { presence, timer: setTimeout(() => { saved.delete(botId); emit(); }, SAVED_HOLD_MS) });
  emit();
}

export function presenceDraft(): PresenceDraft | null {
  return draft;
}

export function failureKey(entry: Pick<PresenceEntryView, "id" | "updatedAt">): string {
  return `${entry.id}@${entry.updatedAt}`;
}

export function markPresenceFailed(key: string, reason: string): void {
  if (failed.get(key) === reason) return;
  failed.set(key, reason);
  emit();
}

export function presenceFailure(key: string): string | null {
  return failed.get(key) ?? null;
}

export function resetPresenceState(): void {
  draft = null;
  failed.clear();
  for (const entry of saved.values()) clearTimeout(entry.timer);
  saved.clear();
  emit();
}

export function usePresenceVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

export function shownPresence(bot: { id: string; primary?: boolean; presence?: Presence }): Presence {
  if (draft && draft.botId === bot.id) return draft.presence;
  const held = saved.get(bot.id);
  if (held) return held.presence;
  return bot.presence ?? defaultPresence(bot.id, !!bot.primary);
}

export function usePresenceList(enabled = true) {
  return useLive("presences_list", {}, { pollMs: 0, enabled });
}

export function useCustomPresences(enabled = true): ReadonlyMap<string, PresenceEntryView> {
  const presences = usePresenceList(enabled).data?.presences;
  return useMemo(() => new Map((presences ?? []).filter((entry) => entry.source === "stored" && entry.code).map((entry) => [entry.id, entry])), [presences]);
}
