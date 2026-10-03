import { useEffect, useMemo, useState } from "react";
import { useAtomValue } from "jotai";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import type { SidebarProject } from "../model/use-sidebar-data.js";
import { sidebarBackgroundThreadsAtom } from "../preferences/atoms.js";
import { backgroundThreadIds } from "./background-threads.js";

const botThreadsSchema = z.array(z.object({ threadId: z.string() }));
// Only read the public fields needed to identify attached threads. Malformed
// stored automations can omit execution; the overview includes them too.
const overviewSchema = z.object({ automations: z.array(z.object({
  automation: z.object({ execution: z.object({ targetThreadId: z.string().optional() }).optional() }),
})) });

export function useBackgroundThreads(projects: SidebarProject[]) {
  const sdk = useSdk();
  const mode = useAtomValue(sidebarBackgroundThreadsAtom);
  const [botIds, setBotIds] = useState<ReadonlySet<string>>(new Set());
  const [automationIds, setAutomationIds] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    let active = true;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      await Promise.allSettled([
        Promise.resolve().then(() => sdk.plugins.callRpc({ pluginId: "studio", method: "teams_threadBots", input: {}, outputSchema: botThreadsSchema, signal: AbortSignal.timeout(10_000) }))
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
  return useMemo(() => {
    const allThreads = projects.flatMap((project) => project.threads);
    const ids = backgroundThreadIds(allThreads, new Set([...botIds, ...automationIds]));
    const background = mode === "all" ? [] : allThreads.filter((thread) => ids.has(thread.id) && !thread.isHidden);
    const visibleProjects = mode === "all" ? projects : projects.flatMap((project) => {
      const threads = project.threads.filter((thread) => !ids.has(thread.id));
      // Omit a group emptied by moving its background threads, but preserve
      // genuinely empty projects and their existing visibility preferences.
      if (project.threads.length > 0 && threads.length === 0) return [];
      return [threads.length === project.threads.length ? project : { ...project, threads }];
    });
    return { projects: visibleProjects, background };
  }, [projects, botIds, automationIds, mode]);
}
