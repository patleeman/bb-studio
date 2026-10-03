// The office UI's view of the office RPCs (docs/office-model.md). Space and
// folder types come from src/office/contract.ts; the rest mirror the spec
// until their stages land in that contract.
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { STUDIO_REALTIME_CHANNEL } from "@bb-studio/kit/contract";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { OfficeOutput, OfficeSpace } from "../../office/contract";

export type Space = OfficeSpace;
export type SpaceTreeResult = OfficeOutput<"space_tree">;
export type TreeFolder = SpaceTreeResult["folders"][number] & { hasRepo?: boolean; branch?: string | null };
export type TreeItem = TreeFolder["items"][number] & { icon?: string | null };

/** "pluginId:id", the ref favorites and links use. */
export function itemRef(item: Pick<TreeItem, "pluginId" | "id">): string {
  return `${item.pluginId}:${item.id}`;
}

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

export interface Conversation {
  id: string;
  title: string;
  memberBotIds: string[];
  isDirect: boolean;
  needsYou: boolean;
  unread: boolean;
  href: string;
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

export interface InboxCounts {
  bySpace: Record<string, { requests: number; unreadReports: number }>;
}

export interface WorkingTask {
  id: string;
  botId: string;
  title: string;
  status: "working" | "waiting" | "review" | "done";
  note: string | null;
  recurring: string | null;
  href: string;
  updatedAt: number;
}

export interface Home {
  needsYou: InboxEvent[];
  working: WorkingTask[];
  reports: InboxEvent[];
  recent: TreeItem[];
}

export function useSpaceTree(spaceId: string | null) {
  return useLive<SpaceTreeResult & { favorites?: string[] }>("space_tree", { spaceId }, { enabled: spaceId !== null });
}

export function useTeam(spaceId: string | null) {
  const team = useLive<{ bots: TeamBot[] }>("team_list", { spaceId }, { enabled: spaceId !== null });
  return { ...team, bots: team.data?.bots ?? [] };
}

export interface BotDesk {
  bot: TeamBot & { model: string | null; trust: "read_only" | "ask" | "act"; spaceId: string };
  tasks: WorkingTask[];
  /** The DM: one conversation with only this bot, and the thread behind it. */
  directConversationId: string | null;
  directThreadId: string | null;
  profileHref: string;
  memory: { mission: string; memory: string } | null;
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

// The Space the user is in. Both sidebar slots and every office page read it,
// so it lives in one module-level store, persisted per browser.
const SPACE_KEY = "bb-studio.office.space";
const listeners = new Set<() => void>();
let currentSpace: string | null = readStoredSpace();

function readStoredSpace(): string | null {
  try { return globalThis.localStorage?.getItem(SPACE_KEY) ?? null; } catch { return null; }
}

export function setCurrentSpaceId(id: string): void {
  if (id === currentSpace) return;
  currentSpace = id;
  try { globalThis.localStorage?.setItem(SPACE_KEY, id); } catch { /* private mode */ }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === SPACE_KEY) { currentSpace = event.newValue; listener(); }
  };
  globalThis.addEventListener?.("storage", onStorage);
  return () => { listeners.delete(listener); globalThis.removeEventListener?.("storage", onStorage); };
}

export function useSpaces() {
  const spaces = useLive<{ spaces: Space[] }>("spaces_list", {}, { pollMs: 0 });
  const stored = useSyncExternalStore(subscribe, () => currentSpace, () => null);
  const list = spaces.data?.spaces ?? [];
  const current = list.find((space) => space.id === stored) ?? list.find((space) => space.isDefault) ?? list[0] ?? null;
  return { ...spaces, spaces: list, current };
}

export function useInboxCounts() {
  return useLive<InboxCounts>("inbox_counts", {}, { pollMs: 30_000 });
}

export function requestCount(counts: InboxCounts | null, spaceId: string | "all"): number {
  if (!counts) return 0;
  if (spaceId !== "all") return counts.bySpace[spaceId]?.requests ?? 0;
  return Object.values(counts.bySpace).reduce((sum, entry) => sum + entry.requests, 0);
}
