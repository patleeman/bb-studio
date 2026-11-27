// What a to-do's tab (TodoTab.tsx) and card (src/tasks/ui/TaskCard.tsx)
// read besides the to-do: the people it can belong to, and its actions.
import { useSdk } from "@get-bb/plugin-sdk/app";
import { useStudioSettings } from "../../settings/ui/use-settings";
import { useEffect, useMemo, useState } from "react";
import { useLive } from "../../ui/live";

const PERSONAL_PROJECT_ID = "proj_personal";

export function useTodosZone(): string | undefined {
  const { timeZone } = useStudioSettings();
  return timeZone ?? undefined;
}

let projectNames: Promise<Map<string, string>> | null = null;
let projectNamesAt = 0;
const PROJECT_NAMES_MS = 30_000;

export interface LoopPeople {
  /** The primary Bot: todos belong to it (the Chief of Staff). */
  botId: string | null;
  botName: string;
  botThreadId: string | null;
  /** Lead thread id → "Larkspur lead". */
  leads: ReadonlyMap<string, string>;
  /** Hand off targets: the Bot, then each project's lead (decision 9). */
  targets: { owner: string; name: string }[];
  projects?: ReadonlyMap<string, string>;
}

/** The Bot and the active project leads, named. */
export function useLoopPeople(): LoopPeople {
  const sdk = useSdk();
  const bot = useLive("bot_get", {}, { pollMs: 120_000 }).data?.bot ?? null;
  const leads = useLive("project_leads", {}, { pollMs: 120_000 }).data?.leads ?? [];
  const [projects, setProjects] = useState<Map<string, string>>(new Map());
  const [tick, setTick] = useState(0);
  useEffect(() => { const timer = setInterval(() => setTick((n) => n + 1), PROJECT_NAMES_MS); return () => clearInterval(timer); }, []);
  useEffect(() => {
    let live = true;
    if (Date.now() - projectNamesAt > PROJECT_NAMES_MS) { projectNames = null; projectNamesAt = Date.now(); }
    projectNames ??= sdk.projects.list({ includePersonal: true })
      .then((list) => new Map((list as { id: string; name: string }[]).map(({ id, name }) => [id, name])))
      .catch(() => { projectNames = null; return new Map<string, string>(); });
    void projectNames.then((names) => { if (live) setProjects(names); });
    return () => { live = false; };
  }, [sdk, tick]);
  return useMemo(() => {
    const botName = bot?.name ?? "Chief of Staff";
    const named = leads
      .filter((lead) => lead.leadThreadId && lead.projectId !== PERSONAL_PROJECT_ID)
      .map((lead) => [lead.leadThreadId!, `${projects.get(lead.projectId) ?? "Project"} lead`] as const)
      .sort((a, b) => a[1].localeCompare(b[1]));
    return {
      botId: bot?.id ?? null,
      botName,
      botThreadId: bot?.threadId ?? null,
      leads: new Map(named),
      targets: [{ owner: "cos", name: botName }, ...named.map(([threadId, name]) => ({ owner: `thread:${threadId}`, name }))],
      projects,
    };
  }, [bot?.id, bot?.name, bot?.threadId, leads, projects]);
}


