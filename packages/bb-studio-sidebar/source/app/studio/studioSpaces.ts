import { errorMessage } from "@bb-studio/kit/format";
import { useEffect, useRef } from "react";
import { atom, useAtomValue, useSetAtom } from "jotai";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import type { StudioSpace } from "./space-groups.js";

/**
 * Studio's Spaces for By space. Studio is another plugin, so its realtime
 * channel doesn't reach this one: Studio's Spaces section re-announces its
 * changes as this window event, and the list also refetches on focus and
 * every 30 seconds while By space shows.
 */
export const STUDIO_CHANGED_EVENT = "bb-studio:studio-changed";
/** Studio's event after one of its Space dialogs changes a Space; detail `{ spaceId }`. */
export const SPACE_CHANGED_EVENT = "studio:space-changed";

/**
 * The sidebar's organization, shared with Studio without the kit: Studio
 * hides its own Spaces section while this reads "space". Same window gets the
 * event; other windows get the storage event.
 */
export const SIDEBAR_ORGANIZATION_STORAGE_KEY = "bb-studio:sidebar-organization";
export const SIDEBAR_ORGANIZATION_EVENT = "bb-studio:sidebar-organization";

export function publishSidebarOrganization(mode: string): void {
  try {
    if (localStorage.getItem(SIDEBAR_ORGANIZATION_STORAGE_KEY) === mode) return;
    localStorage.setItem(SIDEBAR_ORGANIZATION_STORAGE_KEY, mode);
  } catch {
    // Storage can be unavailable (private mode); the event still reaches this window.
  }
  window.dispatchEvent(new CustomEvent(SIDEBAR_ORGANIZATION_EVENT, { detail: mode }));
}

/**
 * Moves sent to Studio but not yet seen in a fetched `space_of_threads`, by
 * thread. A refetch that started before a move settled still carries the old
 * Space, so each fetched map gets these laid over it until a load that began
 * after the move settled.
 */
interface PendingSpaceMove {
  spaceId: string;
  /** The last load started before the move settled; null while in flight. */
  settledAfterLoad: number | null;
}
const pendingSpaceMoves = new Map<string, PendingSpaceMove>();
let spaceLoadSeq = 0;

/** Records a move; call the returned function once Studio answers. */
export function beginPendingSpaceMove(threadIds: readonly string[], spaceId: string): () => void {
  const move: PendingSpaceMove = { spaceId, settledAfterLoad: null };
  for (const id of threadIds) pendingSpaceMoves.set(id, move);
  return () => { move.settledAfterLoad = spaceLoadSeq; };
}

/** Numbers a `space_of_threads` load as it starts. */
export function startSpaceLoad(): number {
  return ++spaceLoadSeq;
}

/**
 * `spaceOf` with pending moves laid over it. Pass the load that fetched it to
 * drop moves that load already reflects.
 */
export function withPendingSpaceMoves(
  spaceOf: Readonly<Record<string, string>>,
  load?: number,
): Record<string, string> {
  const next = { ...spaceOf };
  for (const [threadId, move] of pendingSpaceMoves) {
    if (load !== undefined && move.settledAfterLoad !== null && load > move.settledAfterLoad) {
      pendingSpaceMoves.delete(threadId);
      continue;
    }
    next[threadId] = move.spaceId;
  }
  return next;
}

/**
 * Lead changes sent to Studio but maybe not in a fetched `space_lead` yet, by
 * Space, laid over each load like pending moves so an older refetch can't
 * put the old lead back.
 */
interface PendingLead {
  threadId: string | null;
  /** The last load started before the change settled; null while in flight. */
  settledAfterLoad: number | null;
}
const pendingLeads = new Map<string, PendingLead>();

/** Records a lead change; call the returned function once Studio answers. */
export function beginPendingLead(spaceId: string, threadId: string | null): () => void {
  const change: PendingLead = { threadId, settledAfterLoad: null };
  pendingLeads.set(spaceId, change);
  return () => { change.settledAfterLoad = spaceLoadSeq; };
}

/** `leads` with pending changes laid over it; pass the load that fetched it. */
export function withPendingLeads(
  leads: Readonly<Record<string, string | null>>,
  load?: number,
): Record<string, string | null> {
  const next = { ...leads };
  for (const [spaceId, change] of pendingLeads) {
    if (load !== undefined && change.settledAfterLoad !== null && load > change.settledAfterLoad) {
      if (pendingLeads.get(spaceId) === change) pendingLeads.delete(spaceId);
      continue;
    }
    next[spaceId] = change.threadId;
  }
  return next;
}

/**
 * A Chief of Staff change sent to Studio but maybe not in a fetched
 * `chief_of_staff` yet, laid over each load like pending lead changes.
 */
let pendingChief: PendingLead | null = null;

/** Records a Chief of Staff change; call the returned function once Studio answers. */
export function beginPendingChiefOfStaff(threadId: string | null): () => void {
  const change: PendingLead = { threadId, settledAfterLoad: null };
  pendingChief = change;
  return () => { change.settledAfterLoad = spaceLoadSeq; };
}

/** `chiefOfStaff` with a pending change laid over it; pass the load that fetched it. */
export function withPendingChiefOfStaff(chiefOfStaff: string | null, load?: number): string | null {
  const change = pendingChief;
  if (!change) return chiefOfStaff;
  if (load !== undefined && change.settledAfterLoad !== null && load > change.settledAfterLoad) {
    pendingChief = null;
    return chiefOfStaff;
  }
  return change.threadId;
}

const chiefSchema = z.object({
  threadId: z.string().nullable(),
  run: z.object({ enabled: z.boolean(), cadence: z.string() }).passthrough().nullable().catch(null),
}).passthrough();

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
const treeSchema = z.object({
  spaces: z.array(z.object({
    id: z.string(),
    itemCount: z.number().catch(0),
    open: z.array(z.object({
      pluginId: z.string(),
      id: z.string(),
      title: z.string(),
      icon: z.string().nullable().catch(null),
      kindIcon: z.string().catch("File"),
      href: z.string(),
      pinned: z.boolean().catch(false),
      kindLabel: z.string().catch(""),
      updatedAt: z.number().catch(0),
      preview: z.string().nullable().catch(null),
    }).passthrough()).catch([]),
    items: z.array(z.object({
      pluginId: z.string(),
      id: z.string(),
      title: z.string(),
      icon: z.string().nullable().catch(null),
      kindIcon: z.string().catch("File"),
      href: z.string(),
      updatedAt: z.number().catch(0),
    }).passthrough()).catch([]),
  }).passthrough()),
});

/** A Space's open Studio item, as the sidebar's Studio list shows it. */
export interface SpaceSidebarItem {
  pluginId: string;
  id: string;
  title: string;
  icon: string | null;
  kindIcon: string;
  href: string;
  /** Pinned items stay at the top of the Space's list. */
  pinned: boolean;
  kindLabel: string;
  updatedAt: number;
  preview: string | null;
}

/** One of the Space's items, open or not, newest first, for the browse menu. */
export interface SpaceBrowseItem {
  pluginId: string;
  id: string;
  title: string;
  icon: string | null;
  kindIcon: string;
  href: string;
  updatedAt: number;
}

export interface SpaceItems {
  /** The Space's items open as tabs, in the order they were opened. */
  open: SpaceSidebarItem[];
  /** The Space's newest items, open or not; Studio caps the list. */
  all: SpaceBrowseItem[];
  /** Every item the Space holds, open or not. */
  count: number;
}

export type StudioSpacesState =
  | { status: "loading" }
  | { status: "unavailable"; error: string }
  | {
    status: "ready";
    spaces: StudioSpace[];
    /** Thread id to Space id; empty until `threadsLoaded`. */
    spaceOf: Record<string, string>;
    leads: Record<string, string | null>;
    /** Each Space's lead heartbeat cadence while it's on, such as "hourly". */
    heartbeats: Record<string, string | null>;
    /** Each Space's Studio items; empty until `threadsLoaded`. */
    items: Record<string, SpaceItems>;
    /** The Chief of Staff thread, above every Space; null without one or with an older Studio. By space only. */
    chiefOfStaff: string | null;
    /** The Chief of Staff's heartbeat cadence while it's on. */
    chiefOfStaffHeartbeat: string | null;
    threadsLoaded: boolean;
  };

export const studioSpacesAtom = atom<StudioSpacesState>({ status: "loading" });

export function useStudioSpaces(): StudioSpacesState {
  return useAtomValue(studioSpacesAtom);
}

/**
 * Loads Studio's Spaces and each Space's lead in every mode: the Organize
 * menu needs the Spaces and archive needs the leads. In By space it also
 * loads each thread's Space and each Space's Studio items. A Studio without Spaces leaves the state unavailable.
 */
export function useStudioSpacesSync(spaceMode: boolean, threadCount: number): void {
  const sdk = useSdk();
  const setState = useSetAtom(studioSpacesAtom);
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    let active = true;
    let running = false;
    let again = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const call = async <T,>(method: string, input: unknown, outputSchema: z.ZodType<T>): Promise<T> =>
      outputSchema.parse(await sdk.plugins.callRpc({ pluginId: "studio", method, input: input as never, outputSchema, signal: AbortSignal.timeout(10_000) }));
    const load = async () => {
      if (running) { again = true; return; }
      running = true;
      const loadSeq = startSpaceLoad();
      try {
        const { spaces } = await call("spaces", null, spacesSchema);
        let spaceOf: Record<string, string> = {};
        let leads: Record<string, string | null> = {};
        let heartbeats: Record<string, string | null> = {};
        let items: Record<string, SpaceItems> = {};
        let chiefOfStaff: string | null = null;
        let chiefOfStaffHeartbeat: string | null = null;
        // Leads load in every mode: a lead can't be archived from any view.
        const leadsLoad = Promise.all(spaces.map((space) => call("space_lead", { spaceId: space.id }, leadSchema)
          .then((lead) => [space.id, lead] as const, () => [space.id, null] as const)));
        if (spaceMode) {
          const [of, tree, chief] = await Promise.all([
            call("space_of_threads", {}, spaceOfSchema),
            // Items are a nicety: a failure leaves the lists empty, not the sidebar.
            call("spaceTree", {}, treeSchema).catch(() => ({ spaces: [] })),
            // An older Studio has no Chief of Staff: no pin.
            call("chief_of_staff", {}, chiefSchema).catch(() => null),
          ]);
          chiefOfStaff = withPendingChiefOfStaff(chief?.threadId ?? null, loadSeq);
          chiefOfStaffHeartbeat = chief?.threadId && chief.run?.enabled ? chief.run.cadence : null;
          spaceOf = withPendingSpaceMoves(of.threads, loadSeq);
          items = Object.fromEntries(tree.spaces.map((space) => [space.id, {
            open: space.open.map(({ pluginId, id, title, icon, kindIcon, href, pinned, kindLabel, updatedAt, preview }) => ({ pluginId, id, title, icon, kindIcon, href, pinned, kindLabel, updatedAt, preview })),
            all: space.items.map(({ pluginId, id, title, icon, kindIcon, href, updatedAt }) => ({ pluginId, id, title, icon, kindIcon, href, updatedAt })),
            count: space.itemCount,
          }]));
        }
        const leadRows = await leadsLoad;
        leads = withPendingLeads(Object.fromEntries(leadRows.map(([id, lead]) => [id, lead?.leadThreadId ?? null])), loadSeq);
        heartbeats = Object.fromEntries(leadRows.map(([id, lead]) => [id, lead?.leadThreadId && lead.run?.enabled ? lead.run.cadence : null]));
        const list = spaces.map(({ id, name, color, icon, defaultProjectId, isDefault, projectIds }) => ({ id, name, color, icon, defaultProjectId, isDefault, projectIds }));
        if (active) setState({ status: "ready", spaces: list, spaceOf, leads, heartbeats, items, chiefOfStaff, chiefOfStaffHeartbeat, threadsLoaded: spaceMode });
      } catch (error) {
        const message = errorMessage(error);
        // Keep the last good load through a passing failure.
        if (active) setState((current) => current.status === "ready" && current.threadsLoaded === spaceMode ? current : { status: "unavailable", error: message });
      } finally {
        running = false;
        if (again && active) { again = false; void load(); }
      }
    };
    const soon = () => {
      if (timer) return;
      timer = setTimeout(() => { timer = null; void load(); }, 250);
    };
    refreshRef.current = soon;
    void load();
    const poll = spaceMode ? setInterval(soon, 30_000) : null;
    window.addEventListener("focus", soon);
    window.addEventListener(STUDIO_CHANGED_EVENT, soon);
    window.addEventListener(SPACE_CHANGED_EVENT, soon);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      if (poll) clearInterval(poll);
      window.removeEventListener("focus", soon);
      window.removeEventListener(STUDIO_CHANGED_EVENT, soon);
      window.removeEventListener(SPACE_CHANGED_EVENT, soon);
      refreshRef.current = () => {};
    };
  }, [sdk, setState, spaceMode]);
  // A new thread may have joined a Space; Studio's signal can lag or be absent.
  const lastCount = useRef(threadCount);
  useEffect(() => {
    if (lastCount.current === threadCount) return;
    lastCount.current = threadCount;
    if (spaceMode) refreshRef.current();
  }, [spaceMode, threadCount]);
}
