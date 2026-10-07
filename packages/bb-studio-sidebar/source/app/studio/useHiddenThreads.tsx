import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAtom } from "jotai";
import { useSdk } from "@get-bb/plugin-sdk/app";
import type { SidebarProject } from "../model/use-sidebar-data.js";
import type { SidebarThread } from "../model/sidebar-thread.js";
import { sidebarHiddenThreadsAtom } from "../preferences/atoms.js";
import { filterHiddenThreads, hiddenThreadIds } from "./hidden-threads.js";

export interface HiddenThreadsState {
  hidden: ReadonlyMap<string, number>;
  /** Every hidden thread, including those hidden with a hidden ancestor. */
  hiddenIds: ReadonlySet<string>;
  revealed: ReadonlySet<string>;
  setRevealed: (sectionKey: string, revealed: boolean) => void;
}

const HiddenThreadsContext = createContext<HiddenThreadsState | null>(null);
export const HiddenThreadsProvider = HiddenThreadsContext.Provider;

export function useHiddenThreadsState(): HiddenThreadsState | null {
  return useContext(HiddenThreadsContext);
}

/**
 * Threads the user hid from their row's menu leave every section. Show on a
 * section's last row reveals them there until the window reloads.
 */
export function useHiddenThreads({
  projects,
  sectionKeyOf,
  keepIds,
}: {
  projects: SidebarProject[];
  sectionKeyOf: (threads: readonly SidebarThread[]) => (thread: SidebarThread) => string;
  keepIds: ReadonlySet<string>;
}) {
  const [hiddenPreference, setHiddenPreference] = useAtom(sidebarHiddenThreadsAtom);
  const [revealed, setRevealedKeys] = useState<ReadonlySet<string>>(new Set());
  const setRevealed = useCallback((sectionKey: string, value: boolean) => {
    setRevealedKeys((current) => {
      if (current.has(sectionKey) === value) return current;
      const next = new Set(current);
      if (value) next.add(sectionKey);
      else next.delete(sectionKey);
      return next;
    });
  }, []);
  const allThreads = useMemo(() => projects.flatMap((project) => project.threads), [projects]);
  usePruneDeletedHiddenThreads(allThreads, hiddenPreference, setHiddenPreference);
  const hiddenIds = useMemo(() => hiddenThreadIds(allThreads, hiddenPreference), [allThreads, hiddenPreference]);
  const { visibleProjects, hidden } = useMemo(() => {
    if (hiddenIds.size === 0) return { visibleProjects: projects, hidden: new Map<string, number>() };
    const result = filterHiddenThreads({
      threads: allThreads,
      hiddenIds,
      sectionKeyOf: sectionKeyOf(allThreads),
      revealed,
      keepIds,
    });
    const visibleIds = new Set(result.visible.map((thread) => thread.id));
    const filtered = projects.map((project) => {
      const threads = project.threads.filter((thread) => visibleIds.has(thread.id));
      return threads.length === project.threads.length ? project : { ...project, threads };
    });
    return { visibleProjects: filtered, hidden: result.hidden };
  }, [allThreads, hiddenIds, keepIds, projects, revealed, sectionKeyOf]);
  const state = useMemo<HiddenThreadsState>(() => ({ hidden, hiddenIds, revealed, setRevealed }), [hidden, hiddenIds, revealed, setRevealed]);
  return { projects: visibleProjects, hiddenIds, state };
}

/** Whether an error is BB saying the thread doesn't exist. */
function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { status, code } = error as { status?: unknown; code?: unknown };
  return status === 404 || code === "not_found" || code === "thread_not_found";
}

/**
 * Drops hidden ids of threads BB no longer has. An id missing from the
 * listed threads may be archived, so each is looked up once per window and
 * only a not-found answer removes it; archived threads and failed lookups stay.
 */
function usePruneDeletedHiddenThreads(
  threads: readonly SidebarThread[],
  hidden: readonly string[],
  setHidden: (update: (current: string[]) => string[]) => void,
): void {
  const sdk = useSdk();
  const checked = useRef(new Set<string>());
  useEffect(() => {
    const listed = new Set(threads.map((thread) => thread.id));
    const unknown = hidden.filter((id) => !listed.has(id) && !checked.current.has(id));
    if (!unknown.length) return;
    for (const id of unknown) checked.current.add(id);
    void Promise.all(unknown.map((threadId) => Promise.resolve().then(() => sdk.threads.get({ threadId })).then(
      () => null,
      (error: unknown) => isNotFound(error) ? threadId : null,
    ))).then((results) => {
      const gone = new Set(results.filter((id): id is string => id !== null));
      if (gone.size) setHidden((current) => current.filter((id) => !gone.has(id)));
    });
  }, [hidden, sdk, setHidden, threads]);
}
