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

const spacesSchema = z.object({
  spaces: z.array(z.object({
    id: z.string(),
    name: z.string(),
    color: z.string().catch("currentColor"),
    icon: z.string().nullable().catch(null),
    defaultProjectId: z.string().nullable().catch(null),
    isDefault: z.boolean().catch(false),
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
}

export interface SpaceItems {
  /** The Space's items open as tabs, in the order they were opened. */
  open: SpaceSidebarItem[];
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
    threadsLoaded: boolean;
  };

export const studioSpacesAtom = atom<StudioSpacesState>({ status: "loading" });

export function useStudioSpaces(): StudioSpacesState {
  return useAtomValue(studioSpacesAtom);
}

/**
 * Loads Studio's Spaces. Outside By space it only checks they exist, for the
 * Organize menu; in By space it also loads each thread's Space, each Space's
 * lead, and each Space's Studio items. A Studio without Spaces leaves the state unavailable.
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
      try {
        const { spaces } = await call("spaces", null, spacesSchema);
        let spaceOf: Record<string, string> = {};
        let leads: Record<string, string | null> = {};
        let heartbeats: Record<string, string | null> = {};
        let items: Record<string, SpaceItems> = {};
        if (spaceMode) {
          const [of, leadRows, tree] = await Promise.all([
            call("space_of_threads", {}, spaceOfSchema),
            Promise.all(spaces.map((space) => call("space_lead", { spaceId: space.id }, leadSchema)
              .then((lead) => [space.id, lead] as const, () => [space.id, null] as const))),
            // Items are a nicety: a failure leaves the lists empty, not the sidebar.
            call("spaceTree", {}, treeSchema).catch(() => ({ spaces: [] })),
          ]);
          spaceOf = of.threads;
          leads = Object.fromEntries(leadRows.map(([id, lead]) => [id, lead?.leadThreadId ?? null]));
          heartbeats = Object.fromEntries(leadRows.map(([id, lead]) => [id, lead?.leadThreadId && lead.run?.enabled ? lead.run.cadence : null]));
          items = Object.fromEntries(tree.spaces.map((space) => [space.id, {
            open: space.open.map(({ pluginId, id, title, icon, kindIcon, href, pinned }) => ({ pluginId, id, title, icon, kindIcon, href, pinned })),
            count: space.itemCount,
          }]));
        }
        const list = spaces.map(({ id, name, color, icon, defaultProjectId, isDefault }) => ({ id, name, color, icon, defaultProjectId, isDefault }));
        if (active) setState({ status: "ready", spaces: list, spaceOf, leads, heartbeats, items, threadsLoaded: spaceMode });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
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
