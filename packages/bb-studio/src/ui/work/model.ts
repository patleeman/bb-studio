// The work UI's data hooks: the plugin RPC client, and live loads shared by
// every component that asks for the same thing.
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { STUDIO_REALTIME_CHANNEL } from "@bb-studio/kit/contract";
import { useCallback, useEffect, useSyncExternalStore } from "react";

export type BotState = "idle" | "working" | "needs_you";

export interface TeamBot {
  id: string;
  name: string;
  avatar: string | null;
  role: string | null;
  state: BotState;
  activeTaskCount: number;
  /** codex, claude-code, or an external agent such as hermes or openclaw. */
  providerId?: string;
}

export interface InboxAction {
  id: string;
  label: string;
  primary?: boolean;
}

export interface InboxEvent {
  key: string;
  spaceId: string;
  type: "request" | "report" | "comment";
  source: string;
  botId: string | null;
  threadId: string | null;
  item: { ref: string; title: string; href: string } | null;
  title: string;
  body: string;
  actions: InboxAction[] | null;
  /** Requests that take a typed answer, such as a question. */
  answerable?: boolean;
  href: string | null;
  createdAt: number;
  readAt: number | null;
}

type Call = (method: string, input?: unknown) => Promise<unknown>;

/** The plugin RPC client without the contract's method typing. */
export function useCall(): Call {
  const rpc = useRpc() as unknown as { call: Call };
  return useCallback((method: string, input?: unknown) => rpc.call(method, input ?? null), [rpc]);
}

interface LiveState<T> { data: T | null; error: string | null; loading: boolean }

/**
 * One shared load per method and input. Several components read the same
 * RPC (the sidebar's two slots and every page read Spaces, tabs and counts),
 * and each used to fetch it on its own, again on every Studio change; while
 * the server worked through those, the page being opened waited.
 */
interface LiveEntry {
  state: LiveState<unknown>;
  listeners: Set<() => void>;
  call: Call | null;
  inflight: boolean;
  /** A change arrived during a load: load once more after it. */
  again: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  loadedAt: number;
}

const liveEntries = new Map<string, LiveEntry>();
/** Change signals come in bursts while agents work; one refetch per burst. */
const COALESCE_MS = 250;

function liveEntry(key: string): LiveEntry {
  let entry = liveEntries.get(key);
  if (!entry) {
    entry = { state: { data: null, error: null, loading: true }, listeners: new Set(), call: null, inflight: false, again: false, timer: null, loadedAt: 0 };
    liveEntries.set(key, entry);
  }
  return entry;
}

function setLive(entry: LiveEntry, state: LiveState<unknown>) {
  entry.state = state;
  for (const listener of entry.listeners) listener();
}

function loadLive(entry: LiveEntry, method: string, input: unknown) {
  if (!entry.call) return;
  if (entry.inflight) { entry.again = true; return; }
  entry.inflight = true;
  entry.call(method, input)
    .then((data) => { entry.loadedAt = Date.now(); setLive(entry, { data, error: null, loading: false }); })
    .catch((cause: unknown) => setLive(entry, { ...entry.state, error: cause instanceof Error ? cause.message : String(cause), loading: false }))
    .finally(() => {
      entry.inflight = false;
      if (entry.again) { entry.again = false; loadLive(entry, method, input); }
    });
}

function scheduleLive(entry: LiveEntry, method: string, input: unknown) {
  if (entry.timer) return;
  entry.timer = setTimeout(() => { entry.timer = null; loadLive(entry, method, input); }, COALESCE_MS);
}

const DISABLED: LiveState<never> = { data: null, error: null, loading: false };

/**
 * Loads one RPC and refetches it on Studio changes, when the window becomes
 * visible again, and every `pollMs`. Keeps the last good value on error.
 * Components asking for the same method and input share one load.
 */
export function useLive<T>(method: string, input: unknown, options: { enabled?: boolean; pollMs?: number } = {}) {
  const call = useCall();
  const { enabled = true, pollMs = 60_000 } = options;
  const json = JSON.stringify(input ?? null);
  const key = `${method}:${json}`;
  const entry = liveEntry(key);
  entry.call = call;
  const subscribe = useCallback((listener: () => void) => {
    entry.listeners.add(listener);
    return () => { entry.listeners.delete(listener); };
  }, [entry]);
  const state = useSyncExternalStore(subscribe, () => (enabled ? entry.state : DISABLED), () => DISABLED) as LiveState<T>;
  const refresh = useCallback(() => { if (enabled) loadLive(entry, method, JSON.parse(json)); }, [entry, method, json, enabled]);
  const soon = useCallback(() => { if (enabled) scheduleLive(entry, method, JSON.parse(json)); }, [entry, method, json, enabled]);
  useEffect(() => {
    // A fresh load from another component counts; don't fetch again on mount.
    if (Date.now() - entry.loadedAt > 2_000) refresh();
    const onVisible = () => { if (document.visibilityState === "visible") soon(); };
    document.addEventListener("visibilitychange", onVisible);
    const timer = pollMs > 0 ? setInterval(soon, pollMs) : null;
    return () => { document.removeEventListener("visibilitychange", onVisible); if (timer) clearInterval(timer); };
  }, [entry, refresh, soon, pollMs]);
  useRealtime(STUDIO_REALTIME_CHANNEL, soon);
  return { ...state, refresh };
}
