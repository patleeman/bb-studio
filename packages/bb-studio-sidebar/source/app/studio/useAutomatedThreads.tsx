import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAtomValue } from "jotai";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import type { SidebarProject } from "../model/use-sidebar-data.js";
import type { SidebarThread } from "../model/sidebar-thread.js";
import { sidebarAutomatedThreadsAtom } from "../preferences/atoms.js";
import {
  automatedModeFor,
  automatedThreadIds,
  automatedThreadKinds,
  filterAutomatedThreads,
  type AutomatedKind,
} from "./automated-threads.js";

const botThreadsSchema = z.array(z.object({ threadId: z.string() }));
// Only read the public fields needed to identify attached threads. Malformed
// stored automations can omit execution; the overview includes them too.
const overviewSchema = z.object({ automations: z.array(z.object({
  automation: z.object({ execution: z.object({ targetThreadId: z.string().optional() }).optional() }),
})) });

/** Threads attached to bots or automations, refreshed on load, focus, and every 30 seconds. */
function useAttachedThreadIds() {
  const sdk = useSdk();
  const [botIds, setBotIds] = useState<ReadonlySet<string>>(new Set());
  const [automationIds, setAutomationIds] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    let active = true;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      await Promise.allSettled([
        Promise.resolve().then(() => sdk.plugins.callRpc({ pluginId: "bot-teams", method: "threadBots", input: {}, outputSchema: botThreadsSchema, signal: AbortSignal.timeout(10_000) }))
          .then((rows) => { if (active) setBotIds(new Set(rows.map((row) => row.threadId))); }),
        Promise.resolve().then(() => sdk.plugins.callRpc({ pluginId: "automations", method: "automations_overview", input: null, outputSchema: overviewSchema, signal: AbortSignal.timeout(10_000) }))
          .then((result) => { if (active) setAutomationIds(new Set(result.automations.flatMap(({ automation }) => automation.execution?.targetThreadId ? [automation.execution.targetThreadId] : []))); }),
      ]);
      refreshing = false;
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 30_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [sdk]);
  return { botIds, automationIds };
}

export interface AutomatedThreadsState {
  kinds: ReadonlyMap<string, AutomatedKind>;
  hidden: ReadonlyMap<string, number>;
  revealed: ReadonlySet<string>;
  setRevealed: (sectionKey: string, revealed: boolean) => void;
}

const AutomatedThreadsContext = createContext<AutomatedThreadsState | null>(null);
export const AutomatedThreadsProvider = AutomatedThreadsContext.Provider;

export function useAutomatedThreadsState(): AutomatedThreadsState | null {
  return useContext(AutomatedThreadsContext);
}

/**
 * Bot and automation threads stay in their own section and get a mark. Each
 * section's Automated threads choice (Show all, Only with updates, Hide)
 * filters them; Show on the section's last row reveals them until reload.
 */
export function useAutomatedThreads({
  projects,
  sectionKeyOf,
  keepIds,
}: {
  projects: SidebarProject[];
  sectionKeyOf: (threads: readonly SidebarThread[]) => (thread: SidebarThread) => string;
  keepIds: ReadonlySet<string>;
}) {
  const { botIds, automationIds } = useAttachedThreadIds();
  const preferences = useAtomValue(sidebarAutomatedThreadsAtom);
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
  const kinds = useMemo(() => automatedThreadKinds(allThreads, botIds, automationIds), [allThreads, botIds, automationIds]);
  const automatedIds = useMemo(() => automatedThreadIds(allThreads, kinds), [allThreads, kinds]);
  const { visibleProjects, hidden } = useMemo(() => {
    if (automatedIds.size === 0) return { visibleProjects: projects, hidden: new Map<string, number>() };
    const result = filterAutomatedThreads({
      threads: allThreads,
      automatedIds,
      sectionKeyOf: sectionKeyOf(allThreads),
      modeFor: (key) => automatedModeFor(preferences, key),
      revealed,
      keepIds,
    });
    const visibleIds = new Set(result.visible.map((thread) => thread.id));
    const filtered = projects.map((project) => {
      const threads = project.threads.filter((thread) => visibleIds.has(thread.id));
      return threads.length === project.threads.length ? project : { ...project, threads };
    });
    return { visibleProjects: filtered, hidden: result.hidden };
  }, [allThreads, automatedIds, keepIds, preferences, projects, revealed, sectionKeyOf]);
  const state = useMemo<AutomatedThreadsState>(() => ({ kinds, hidden, revealed, setRevealed }), [kinds, hidden, revealed, setRevealed]);
  return { projects: visibleProjects, automatedIds, state };
}
