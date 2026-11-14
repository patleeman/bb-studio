// Studio's own settings in the frontend: one shared copy per window, loaded
// through `settings.get` and refetched when the server says they changed
// (SETTINGS_CHANNEL). It replaces BB's `useSettings` for every setting that
// isn't an API key.
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { errorMessage } from "../../kit/format";
import type { settingsContract } from "../contract";
import { effectiveSettings, SETTINGS_CHANNEL, type SettingValue, type StudioSettingValues } from "../schema";

const PLUGIN_ID = "studio";

interface Answer { values: StudioSettingValues; changed: string[]; timeZone: string; defaultTimeZone?: string }
interface State { data: Answer | null; error: string | null; loading: boolean }

let state: State = { data: null, error: null, loading: true };
const listeners = new Set<() => void>();
let generation = 0;
/** A load is on its way; a second component mounting meanwhile doesn't start another. */
let inflight = false;
const emit = (next: State) => { state = next; for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

type Rpc = ReturnType<typeof useRpc<typeof settingsContract>>;

function load(rpc: Rpc) {
  const mine = ++generation;
  inflight = true;
  void rpc.call("settings.get", null).then(
    (answer) => { if (mine === generation) emit({ data: { ...answer, values: effectiveSettings(answer.values) }, error: null, loading: false }); },
    (cause: unknown) => { if (mine === generation) emit({ ...state, error: errorMessage(cause), loading: false }); },
  ).finally(() => { if (mine === generation) inflight = false; });
}

export interface StudioSettingsState {
  /** Null until the first load (or when it failed). */
  values: StudioSettingValues | null;
  changed: readonly string[];
  timeZone: string | null;
  defaultTimeZone: string | null;
  isLoading: boolean;
  error: string | null;
  /** Saves a change; `null` restores the default. Throws when the server refuses it. */
  set(patch: Record<string, SettingValue | null>): Promise<void>;
}

export function useStudioSettings(): StudioSettingsState {
  const rpc = useRpc<typeof settingsContract>();
  const snapshot = useSyncExternalStore(subscribe, () => state, () => state);
  useEffect(() => { if (!state.data && !inflight) load(rpc); }, [rpc]);
  useRealtime(SETTINGS_CHANNEL, () => load(rpc));
  const set = useCallback(async (patch: Record<string, SettingValue | null>) => {
    generation += 1;
    inflight = false;
    const answer = await rpc.call("settings.set", { values: patch });
    emit({ data: { values: effectiveSettings(answer.values), changed: answer.changed, timeZone: answer.timeZone ?? state.data?.timeZone ?? "", defaultTimeZone: answer.defaultTimeZone ?? state.data?.defaultTimeZone }, error: null, loading: false });
  }, [rpc]);
  return {
    values: snapshot.data?.values ?? null,
    changed: snapshot.data?.changed ?? [],
    timeZone: snapshot.data?.timeZone || null,
    defaultTimeZone: snapshot.data?.defaultTimeZone || null,
    isLoading: snapshot.loading,
    error: snapshot.error,
    set,
  };
}

/**
 * The settings once, synchronously, for registrations that happen before any
 * hook can run (Reactions' menu actions). Defaults when the server can't answer.
 */
export function readStudioSettingsNow(): StudioSettingValues {
  try {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/v1/plugins/${PLUGIN_ID}/rpc/settings.get`, false);
    xhr.setRequestHeader("content-type", "application/json");
    xhr.send("null");
    if (xhr.status !== 200) return effectiveSettings({});
    const body = JSON.parse(xhr.responseText) as { ok?: boolean; result?: { values?: Record<string, unknown> } };
    return effectiveSettings(body.result?.values ?? {});
  } catch {
    return effectiveSettings({});
  }
}
