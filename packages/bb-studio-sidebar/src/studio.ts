// Talking to Studio and to this plugin's server: Spaces, leads, which Space
// each thread is in, each thread's latest line, and the synced preferences.
import { errorMessage } from "@bb-studio/kit/format";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { experimental_usePluginId, useRealtime, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { z } from "zod";
import type { StudioSpace } from "./model.js";
import { DEFAULT_PREFERENCES, parsePreference, PREFERENCE_KEYS, PREFERENCES_CHANGED_CHANNEL, type PreferenceKey, type Preferences } from "./preferences.js";
import type { sidebarRpcContract } from "./server.js";

/** Studio re-announces Space changes as this window event (its realtime channel doesn't reach other plugins). */
export const STUDIO_CHANGED_EVENT = "bb-studio:studio-changed";
/** Studio's event after one of its Space dialogs changes a Space. */
export const SPACE_CHANGED_EVENT = "studio:space-changed";
/** Studio's New Space dialog; no detail. */
export const NEW_SPACE_EVENT = "studio:new-space";
/** One of a Space's dialogs; detail `{ spaceId, dialog }`. */
export const SPACE_DIALOG_EVENT = "studio:space-dialog";
/** Studio's Chief of Staff heartbeat dialog. */
export const CHIEF_DIALOG_EVENT = "studio:chief-dialog";
/**
 * Studio hides its own Spaces section while this reads "space". This list
 * always organizes by Space, so it says so while it's mounted.
 */
const ORGANIZATION_KEY = "bb-studio:sidebar-organization";
/** Tells Studio's composer Space picker which Space a new thread starts in. */
const NEW_THREAD_SPACE_KEY = "studio:new-thread-space";

export type SpaceDialog = "edit" | "delete" | "heartbeat" | "threads" | "projects";

export function openSpaceDialog(spaceId: string, dialog: SpaceDialog): void {
  window.dispatchEvent(new CustomEvent(SPACE_DIALOG_EVENT, { detail: { spaceId, dialog }, cancelable: true }));
}

export function handOffNewThreadSpace(spaceId: string, projectId: string | null): void {
  const detail = { spaceId, projectId, at: Date.now() };
  try { sessionStorage.setItem(NEW_THREAD_SPACE_KEY, JSON.stringify(detail)); } catch { /* storage unavailable */ }
  window.dispatchEvent(new CustomEvent(NEW_THREAD_SPACE_KEY, { detail }));
}

export function publishSpaceOrganization(): void {
  try {
    if (localStorage.getItem(ORGANIZATION_KEY) !== "space") localStorage.setItem(ORGANIZATION_KEY, "space");
  } catch { /* storage unavailable; the event still reaches this window */ }
  window.dispatchEvent(new CustomEvent(ORGANIZATION_KEY, { detail: "space" }));
}

type Sdk = ReturnType<typeof useSdk>;

export async function callStudio<T>(sdk: Sdk, method: string, input: unknown, schema: z.ZodType<T>, timeout = 15_000): Promise<T> {
  return schema.parse(await sdk.plugins.callRpc({
    pluginId: "studio", method, input: input as never, outputSchema: schema, signal: AbortSignal.timeout(timeout),
  }));
}

const spacesSchema = z.object({
  spaces: z.array(z.object({
    id: z.string(),
    name: z.string(),
    color: z.string().catch("currentColor"),
    icon: z.string().nullable().catch(null),
    defaultProjectId: z.string().nullable().catch(null),
    isDefault: z.boolean().catch(false),
    projectIds: z.array(z.string()).catch([]),
  }).passthrough()),
});
const spaceOfSchema = z.object({ threads: z.record(z.string(), z.string()) });
const leadSchema = z.object({
  leadThreadId: z.string().nullable(),
  run: z.object({ enabled: z.boolean(), cadence: z.string() }).passthrough().nullable().catch(null),
}).passthrough();
const itemSchema = z.object({
  pluginId: z.string(),
  id: z.string(),
  title: z.string(),
  icon: z.string().nullable().catch(null),
  kindIcon: z.string().catch("File"),
  href: z.string(),
  updatedAt: z.number().catch(0),
}).passthrough();
const treeSchema = z.object({
  spaces: z.array(z.object({ id: z.string(), items: z.array(itemSchema).catch([]) }).passthrough()),
});

export type SpaceItem = Pick<z.infer<typeof itemSchema>, "pluginId" | "id" | "title" | "icon" | "kindIcon" | "href" | "updatedAt">;

export interface StudioState {
  status: "loading" | "ready" | "unavailable";
  error?: string;
  spaces: StudioSpace[];
  spaceOf: Record<string, string>;
  leads: Record<string, string | null>;
  /** Each Space's lead heartbeat cadence while it's on, such as "hourly". */
  heartbeats: Record<string, string | null>;
  /** Each Space's newest Studio items, for its Browse menu. */
  items: Record<string, SpaceItem[]>;
}

export interface StudioActions {
  moveThreads(threadIds: readonly string[], space: StudioSpace): Promise<void>;
  setLead(spaceId: string, threadId: string | null): void;
}

/**
 * Studio's Spaces, leads, thread placement and items. Refetches on Studio's
 * change events, on focus, every 30 seconds, and when the thread count
 * changes. Moves and lead changes show at once and stay laid over refetches
 * that started before Studio answered them.
 */
export function useStudio(threadCount: number): [StudioState, StudioActions] {
  const sdk = useSdk();
  const [state, setState] = useState<StudioState>({ status: "loading", spaces: [], spaceOf: {}, leads: {}, heartbeats: {}, items: {} });
  const seq = useRef(0);
  // Pending changes: the value, and the last load that started before Studio answered (null while in flight).
  const moves = useRef(new Map<string, { spaceId: string; settled: number | null }>());
  const leadChanges = useRef(new Map<string, { threadId: string | null; settled: number | null }>());
  const refresh = useRef<() => void>(() => {});

  const overlay = useCallback(<V,>(base: Record<string, V>, pending: Map<string, { settled: number | null }>, pick: (entry: never) => V, load?: number) => {
    const next = { ...base };
    for (const [key, entry] of pending) {
      if (load !== undefined && entry.settled !== null && load > entry.settled) pending.delete(key);
      else next[key] = pick(entry as never);
    }
    return next;
  }, []);

  useEffect(() => {
    let live = true;
    let running = false;
    let again = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      if (running) { again = true; return; }
      running = true;
      const loadSeq = ++seq.current;
      try {
        const { spaces } = await callStudio(sdk, "spaces", null, spacesSchema, 10_000);
        const [of, tree, leadRows] = await Promise.all([
          callStudio(sdk, "space_of_threads", {}, spaceOfSchema, 10_000),
          // Items are a nicety: a failure leaves Browse with archived threads only.
          callStudio(sdk, "spaceTree", {}, treeSchema, 10_000).catch(() => ({ spaces: [] })),
          Promise.all(spaces.map((space) => callStudio(sdk, "space_lead", { spaceId: space.id }, leadSchema, 10_000)
            .then((lead) => [space.id, lead] as const, () => [space.id, null] as const))),
        ]);
        if (!live) return;
        setState({
          status: "ready",
          spaces: spaces.map(({ id, name, color, icon, defaultProjectId, isDefault, projectIds }) => ({ id, name, color, icon, defaultProjectId, isDefault, projectIds })),
          spaceOf: overlay(of.threads, moves.current, (entry: { spaceId: string }) => entry.spaceId, loadSeq),
          leads: overlay(Object.fromEntries(leadRows.map(([id, lead]) => [id, lead?.leadThreadId ?? null])), leadChanges.current, (entry: { threadId: string | null }) => entry.threadId, loadSeq),
          heartbeats: Object.fromEntries(leadRows.map(([id, lead]) => [id, lead?.leadThreadId && lead.run?.enabled ? lead.run.cadence : null])),
          items: Object.fromEntries(tree.spaces.map((space) => [space.id, space.items.map(({ pluginId, id, title, icon, kindIcon, href, updatedAt }) => ({ pluginId, id, title, icon, kindIcon, href, updatedAt }))])),
        });
      } catch (error) {
        // Keep the last good load through a passing failure.
        if (live) setState((current) => current.status === "ready" ? current : { ...current, status: "unavailable", error: errorMessage(error) });
      } finally {
        running = false;
        if (again && live) { again = false; void load(); }
      }
    };
    const soon = () => {
      if (timer) return;
      timer = setTimeout(() => { timer = null; void load(); }, 250);
    };
    refresh.current = soon;
    void load();
    const poll = setInterval(soon, 30_000);
    const events = ["focus", STUDIO_CHANGED_EVENT, SPACE_CHANGED_EVENT];
    for (const event of events) window.addEventListener(event, soon);
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      for (const event of events) window.removeEventListener(event, soon);
      refresh.current = () => {};
    };
  }, [overlay, sdk]);

  // A new thread may have joined a Space; Studio's signal can lag.
  const lastCount = useRef(threadCount);
  useEffect(() => {
    if (lastCount.current === threadCount) return;
    lastCount.current = threadCount;
    refresh.current();
  }, [threadCount]);

  const actions = useMemo<StudioActions>(() => ({
    async moveThreads(threadIds, space) {
      if (!threadIds.length) return;
      const entry = { spaceId: space.id, settled: null as number | null };
      for (const id of threadIds) moves.current.set(id, entry);
      setState((current) => ({ ...current, spaceOf: overlay(current.spaceOf, moves.current, (pending: { spaceId: string }) => pending.spaceId) }));
      try {
        await callStudio(sdk, "spaceMembers", { id: space.id, add: threadIds.map((id) => ({ pluginId: "bb-thread", id })), remove: [] }, z.unknown());
        toast.success(`Moved ${threadIds.length === 1 ? "" : `${threadIds.length} threads `}to ${space.isDefault ? "Home" : space.name}`);
      } catch (cause) {
        toast.error(`Couldn't move to ${space.name}: ${errorMessage(cause)}`);
      } finally {
        entry.settled = seq.current;
        window.dispatchEvent(new Event(STUDIO_CHANGED_EVENT));
        window.dispatchEvent(new CustomEvent(SPACE_CHANGED_EVENT, { detail: { spaceId: space.id } }));
      }
    },
    setLead(spaceId, threadId) {
      const entry = { threadId, settled: null as number | null };
      leadChanges.current.set(spaceId, entry);
      setState((current) => ({ ...current, leads: { ...current.leads, [spaceId]: threadId } }));
      void callStudio(sdk, "space_set_lead", { spaceId, threadId }, z.unknown())
        .catch((cause: unknown) => { toast.error(`Couldn't change the lead: ${errorMessage(cause)}`); })
        .finally(() => {
          entry.settled = seq.current;
          window.dispatchEvent(new Event(STUDIO_CHANGED_EVENT));
        });
    },
  }), [overlay, sdk]);

  return [state, actions];
}

export interface ThreadLine {
  text: string;
  kind: "progress" | "failure" | "blocked";
  at: number | null;
}

const linesSchema = z.object({
  lines: z.record(z.string(), z.object({
    text: z.string(),
    kind: z.enum(["progress", "failure", "blocked"]).catch("progress"),
    at: z.number().nullable().catch(null),
  })).catch({}),
});

/**
 * Each listed thread's latest line from Studio's `thread_lines`. Refetches
 * when the threads or their status change (`statusKey`), on focus, and every
 * 30 seconds while visible. Lines already shown stay until replaced.
 */
export function useThreadLines(threadIds: readonly string[], statusKey: string): Readonly<Record<string, ThreadLine>> {
  const sdk = useSdk();
  const [lines, setLines] = useState<Readonly<Record<string, ThreadLine>>>({});
  const ids = useRef(threadIds);
  ids.current = threadIds;
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const asked = ids.current;
    if (!asked.length) return;
    const call = ++sequence.current;
    try {
      const { lines: fetched } = await callStudio(sdk, "thread_lines", { threadIds: [...asked] }, linesSchema);
      if (call !== sequence.current) return;
      setLines((current) => {
        const next = { ...current };
        for (const id of asked) {
          const line = fetched[id];
          if (line?.text.trim()) next[id] = line;
          else delete next[id];
        }
        return next;
      });
    } catch {
      // Studio may be busy; keep what shows.
    }
  }, [sdk]);
  const idsKey = threadIds.join(",");
  useEffect(() => {
    // Status changes arrive in bursts; one fetch follows each.
    const timer = setTimeout(() => void refresh(), 300);
    return () => clearTimeout(timer);
  }, [idsKey, refresh, statusKey]);
  useEffect(() => {
    const visible = () => document.visibilityState === "visible";
    const onFocus = () => void refresh();
    const onVisibility = () => { if (visible()) void refresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    const timer = setInterval(onVisibility, 30_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(timer);
    };
  }, [refresh]);
  return lines;
}

type SetPreference = <Key extends PreferenceKey>(key: Key, update: Preferences[Key] | ((current: Preferences[Key]) => Preferences[Key])) => void;

/**
 * The synced preferences: mirrored to localStorage so a reload paints the
 * last values at once, loaded from the server, kept current over realtime,
 * and written through optimistically.
 */
export function usePreferences(): [Preferences, SetPreference] {
  const rpc = useRpc<typeof sidebarRpcContract>();
  const pluginId = experimental_usePluginId();
  const mirrorKey = `bb.${pluginId}.preferences.v1`;
  const [prefs, setPrefs] = useState<Preferences>(() => readMirror(mirrorKey));
  const latest = useRef(prefs);
  latest.current = prefs;
  const apply = useCallback((values: Partial<Record<string, unknown>>) => {
    setPrefs((current) => {
      const next = { ...current };
      for (const key of PREFERENCE_KEYS) {
        if (!(key in values)) continue;
        const parsed = parsePreference(key, values[key]);
        if (parsed.success) (next as Record<PreferenceKey, unknown>)[key] = parsed.value;
      }
      try { localStorage.setItem(mirrorKey, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, [mirrorKey]);
  useEffect(() => {
    void rpc.call("listPreferences", null).then(({ preferences }) => apply(preferences), (error: unknown) => {
      console.warn(`${pluginId}: loading preferences failed: ${errorMessage(error)}`);
    });
  }, [apply, pluginId, rpc]);
  useRealtime(PREFERENCES_CHANGED_CHANNEL, (signal: unknown) => {
    const { key, value } = (signal ?? {}) as { key?: string; value?: unknown };
    if (typeof key === "string") apply({ [key]: value });
  });
  const set = useCallback<SetPreference>((key, update) => {
    const value = typeof update === "function" ? (update as (current: unknown) => unknown)(latest.current[key]) : update;
    apply({ [key]: value });
    void rpc.call("setPreference", { key, value }).catch((error: unknown) => {
      toast.error(`Couldn't save the sidebar preference: ${errorMessage(error)}`);
    });
  }, [apply, rpc]);
  return [prefs, set];
}

function readMirror(key: string): Preferences {
  const values = { ...DEFAULT_PREFERENCES };
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? "null") as Record<string, unknown> | null;
    for (const name of PREFERENCE_KEYS) {
      const parsed = stored && name in stored ? parsePreference(name, stored[name]) : null;
      if (parsed?.success) (values as Record<PreferenceKey, unknown>)[name] = parsed.value;
    }
  } catch { /* no mirror yet */ }
  return values;
}
