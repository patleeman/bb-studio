import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useAtomValue } from "jotai";
import type { SidebarProject } from "../model/use-sidebar-data.js";
import type { SidebarThread } from "../model/sidebar-thread.js";
import { sidebarHiddenThreadsAtom } from "../preferences/atoms.js";
import { filterHiddenThreads, hiddenThreadIds } from "./hidden-threads.js";

export interface HiddenThreadsState {
  hidden: ReadonlyMap<string, number>;
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
  const hiddenPreference = useAtomValue(sidebarHiddenThreadsAtom);
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
  const state = useMemo<HiddenThreadsState>(() => ({ hidden, revealed, setRevealed }), [hidden, revealed, setRevealed]);
  return { projects: visibleProjects, hiddenIds, state };
}
