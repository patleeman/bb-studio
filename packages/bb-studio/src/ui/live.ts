// Shared live RPC data. Each active entry owns its polling and visibility work.
import { errorMessage } from "../kit/format";
import { requestGeneration } from "../kit/ui/request-generation";
import { STUDIO_REALTIME_CHANNEL } from "../kit/contract";
import type { rpcContract } from "../contract";
import { useRealtime, useRpc, type PluginRpcCallArgs, type PluginRpcResult } from "@get-bb/plugin-sdk/app";
import { useCallback, useSyncExternalStore } from "react";

type Contract = typeof rpcContract;
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
  visible: (() => void) | null;
  loadedAt: number;
}
const liveEntries = new Map<string, LiveEntry>();
const COALESCE_MS = 250;
const DISABLED: LiveState<never> = { data: null, error: null, loading: false };
function liveEntry(key: string): LiveEntry {
  let entry = liveEntries.get(key);
  if (!entry) {
    entry = { state: { data: null, error: null, loading: true }, listeners: new Set(), subscribers: new Map(), call: null, requests: requestGeneration(), inflight: false, again: false, timer: null, poll: null, visible: null, loadedAt: 0 };
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
    if (current()) { entry.loadedAt = Date.now(); setLive(entry, { data, error: null, loading: false }); }
  }, (cause: unknown) => {
    if (current()) setLive(entry, { ...entry.state, error: errorMessage(cause), loading: false });
  }).finally(() => {
    if (!current()) return;
    entry.inflight = false;
    if (entry.again) { entry.again = false; loadLive(entry); }
  });
}
function scheduleLive(entry: LiveEntry) {
  if (entry.timer || !entry.listeners.size) return;
  entry.timer = setTimeout(() => { entry.timer = null; loadLive(entry); }, COALESCE_MS);
}
function pollLive(entry: LiveEntry) {
  if (entry.poll) clearInterval(entry.poll);
  const periods = [...entry.subscribers.values()].filter((ms) => ms > 0);
  entry.poll = periods.length ? setInterval(() => scheduleLive(entry), Math.min(...periods)) : null;
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
  return { ...state, refresh };
}

export type Cadence = "hourly" | "daily" | "weekdays" | "every5minutes" | "every15minutes" | "every30minutes" | "every2hours" | "every6hours" | "weekly" | "custom";
