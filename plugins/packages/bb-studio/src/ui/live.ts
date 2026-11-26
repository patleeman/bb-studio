// Shared live RPC data. Each active entry owns its polling and visibility work.
import { errorMessage } from "../kit/format";
import { requestGeneration } from "../kit/ui/request-generation";
import { STUDIO_REALTIME_CHANNEL } from "../kit/contract";
import type { rpcContract } from "../contract";
import type { rpcContract as loopsContract } from "../loops/contract";
import type { rpcContract as workContract } from "../work/contract";
import type { tasksContract } from "../tasks/rpc-contract";
import type { scheduledContract } from "../loops/scheduled";
import type { authContract } from "../auth/contract";
import type { accountsContract } from "../accounts/contract";
import type { rpcContract as strandsContract } from "../strands/contract";
import { useRealtime, useRealtimeConnectionState, useRpc, type PluginRpcCallArgs, type PluginRpcResult } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

type Contract = typeof rpcContract & typeof loopsContract & typeof scheduledContract & typeof workContract & typeof tasksContract & typeof authContract & typeof accountsContract & typeof strandsContract;
export type Method = keyof Contract;
export type RpcInput<M extends Method> = PluginRpcCallArgs<Contract[M]>[0];
type Call = <M extends Method>(method: M, input: RpcInput<M>) => Promise<PluginRpcResult<Contract[M]>>;
export function useCall(): Call {
  const rpc = useRpc<Contract>();
  return useCallback<Call>((method, input) => rpc.call(method, ...([input] as PluginRpcCallArgs<Contract[typeof method]>)), [rpc]);
}

interface LiveState<T> { data: T | null; error: string | null; loading: boolean }
interface LiveEntry {
  state: LiveState<unknown>;
  listeners: Set<() => void>;
  subscribers: Map<() => void, number>;
  call: (() => Promise<unknown>) | null;
  requests: ReturnType<typeof requestGeneration>;
  inflight: boolean;
  again: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  poll: ReturnType<typeof setInterval> | null;
  pollPeriod: number | null;
  visible: (() => void) | null;
  loadedAt: number;
  /** The last loaded data as JSON, to tell a refetch that changed nothing. */
  json: string | null;
}
const liveEntries = new Map<string, LiveEntry>();
const COALESCE_MS = 250;
const DISABLED: LiveState<never> = { data: null, error: null, loading: false };
function liveEntry(key: string): LiveEntry {
  let entry = liveEntries.get(key);
  if (!entry) {
    entry = { state: { data: null, error: null, loading: true }, listeners: new Set(), subscribers: new Map(), call: null, requests: requestGeneration(), inflight: false, again: false, timer: null, poll: null, pollPeriod: null, visible: null, loadedAt: 0, json: null };
    liveEntries.set(key, entry);
  }
  return entry;
}
function setLive(entry: LiveEntry, state: LiveState<unknown>) {
  entry.state = state;
  for (const listener of entry.listeners) listener();
}
function loadLive(entry: LiveEntry, invalidate = true) {
  if (!entry.call || !entry.listeners.size) return;
  // Joining a request doesn't invalidate it; actual changes request a follow-up.
  if (entry.inflight) { if (invalidate) entry.again = true; return; }
  entry.inflight = true;
  const current = entry.requests.begin();
  entry.call().then((data) => {
    if (!current()) return;
    entry.loadedAt = Date.now();
    // Every Studio signal refetches every query on screen, and most refetches
    // return what is already shown. Keeping the same state then spares every
    // reader a render (a long conversation has dozens of task cards).
    const json = jsonOf(data);
    if (json !== null && json === entry.json && !entry.state.loading && entry.state.error === null) return;
    entry.json = json;
    setLive(entry, { data, error: null, loading: false });
  }, (cause: unknown) => {
    if (!current()) return;
    entry.json = null;
    setLive(entry, { ...entry.state, error: errorMessage(cause), loading: false });
  }).finally(() => {
    if (!current()) return;
    entry.inflight = false;
    if (entry.again) { entry.again = false; loadLive(entry); }
  });
}
/** The data as JSON, or null when it can't be compared that way. */
function jsonOf(data: unknown): string | null {
  try { return JSON.stringify(data) ?? null; } catch { return null; }
}
function scheduleLive(entry: LiveEntry) {
  if (entry.timer || !entry.listeners.size) return;
  entry.timer = setTimeout(() => { entry.timer = null; loadLive(entry); }, COALESCE_MS);
}
function pollLive(entry: LiveEntry) {
  let next: number | null = null;
  for (const ms of entry.subscribers.values()) {
    if (ms > 0 && (next === null || ms < next)) next = ms;
  }
  if (next === entry.pollPeriod) return;
  if (entry.poll) clearInterval(entry.poll);
  entry.pollPeriod = next;
  entry.poll = next !== null ? setInterval(() => { if (document.visibilityState === "visible") scheduleLive(entry); }, next) : null;
}

/** Reads cached live data synchronously without subscribing (for click handlers that don't need reactive updates). */
export function peekLive<M extends Method>(method: M, input: RpcInput<M>): PluginRpcResult<Contract[M]> | null {
  const key = `${method}:${JSON.stringify(input ?? null)}`;
  return (liveEntries.get(key)?.state.data as PluginRpcResult<Contract[M]> | null | undefined) ?? null;
}

/** Active readers share one request and scheduler. The last unsubscribe evicts
 * the entry immediately, releasing cached data and invalidating pending loads. */
export function useLive<M extends Method>(method: M, input: RpcInput<M>, options: { enabled?: boolean; pollMs?: number } = {}) {
  const call = useCall();
  const { enabled = true, pollMs = 60_000 } = options;
  const json = JSON.stringify(input ?? null);
  const key = `${method}:${json}`;
  const entry = enabled ? liveEntry(key) : null;
  const subscribe = useCallback((listener: () => void) => {
    if (!entry) return () => {};
    liveEntries.set(key, entry);
    entry.call = () => call(method, JSON.parse(json));
    entry.listeners.add(listener);
    entry.subscribers.set(listener, pollMs);
    if (!entry.visible) {
      entry.visible = () => { if (document.visibilityState === "visible") scheduleLive(entry); };
      document.addEventListener("visibilitychange", entry.visible);
    }
    pollLive(entry);
    if (Date.now() - entry.loadedAt > 2_000) loadLive(entry, false);
    return () => {
      entry.listeners.delete(listener);
      entry.subscribers.delete(listener);
      pollLive(entry);
      if (entry.listeners.size) return;
      if (entry.timer) clearTimeout(entry.timer);
      if (entry.visible) document.removeEventListener("visibilitychange", entry.visible);
      entry.requests.invalidate();
      entry.call = null;
      entry.inflight = false;
      entry.again = false;
      entry.timer = null;
      entry.visible = null;
      liveEntries.delete(key);
    };
  }, [entry, key, call, method, json, pollMs]);
  // The erased cache is private; method and input determine the public result.
  const state = useSyncExternalStore(subscribe, () => entry?.state ?? DISABLED, () => DISABLED) as LiveState<PluginRpcResult<Contract[M]>>;
  const refresh = useCallback(() => { if (entry) loadLive(entry); }, [entry]);
  const soon = useCallback(() => { if (entry) scheduleLive(entry); }, [entry]);
  useRealtime(STUDIO_REALTIME_CHANNEL, soon);
  // Signals are not replayed after a socket reconnect. Reconcile anything
  // created, changed or deleted while this window was disconnected.
  const connection = useRealtimeConnectionState();
  const previousConnection = useRef(connection);
  useEffect(() => {
    if (connection === "connected" && previousConnection.current !== "connected") soon();
    previousConnection.current = connection;
  }, [connection, soon]);
  return { ...state, refresh };
}

export type Cadence = "hourly" | "daily" | "weekdays" | "every5minutes" | "every15minutes" | "every30minutes" | "every2hours" | "every6hours" | "weekly" | "custom";
