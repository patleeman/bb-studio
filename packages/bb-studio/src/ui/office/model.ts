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

/**
 * Loads one RPC and refetches it on Studio changes, when the window becomes
 * visible again, and every `pollMs`. Keeps the last good value on error.
 */
export function useLive<T>(method: string, input: unknown, options: { enabled?: boolean; pollMs?: number } = {}) {
  const call = useCall();
  const { enabled = true, pollMs = 60_000 } = options;
  const key = JSON.stringify(input ?? null);
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: enabled });
  const seq = useRef(0);
  const refresh = useCallback(() => {
    if (!enabled) return;
    const mine = ++seq.current;
    call(method, JSON.parse(key))
      .then((data) => { if (mine === seq.current) setState({ data: data as T, error: null, loading: false }); })
      .catch((cause: unknown) => {
        if (mine === seq.current) setState((prev) => ({ ...prev, error: cause instanceof Error ? cause.message : String(cause), loading: false }));
      });
  }, [call, method, key, enabled]);
  useEffect(() => {
    refresh();
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    const timer = pollMs > 0 ? setInterval(refresh, pollMs) : null;
    return () => { document.removeEventListener("visibilitychange", onVisible); if (timer) clearInterval(timer); };
  }, [refresh, pollMs]);
  useRealtime(STUDIO_REALTIME_CHANNEL, refresh);
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
