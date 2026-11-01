// What the loop UI reads besides the loops: whether the Attention Router is
// on, the people a loop can belong to, and the actions it takes.
import { useBbNavigate, useSdk, useSettings } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useMemo, useState } from "react";
import { errorMessage } from "../../kit/format";
import { openAppPath } from "../../kit/app/index";
import { useCall, useLive, type RpcInput } from "../../ui/live";
import { botPath } from "../../ui/bot/selection";

const PERSONAL_PROJECT_ID = "proj_personal";

/** The `loopsEnabled` setting (label "Attention Router", default off). */
export function useLoopsEnabled(): boolean {
  const { values } = useSettings();
  return values?.loopsEnabled === true;
}

/** The Bot page's Loops tab: `bot/<botId>/loops`. */
export const loopsPath = (botId: string) => `${botPath(botId)}/loops`;
export const isLoopsPath = (pathname: string) => /^\/plugins\/studio\/studio\/bot\/[^/]+\/loops\/?$/.test(pathname);
export const openLoops = (botId: string | null | undefined) => openAppPath(botId ? loopsPath(botId) : botPath());

/** The Loops pane's thread panel action (app.tsx): the loop list beside a chat. */
export const LOOPS_PANE = "loops";

/**
 * Opens Loops beside the chat (the Loops pane) from inside a thread view, and
 * the Loops tab where there's no side panel. True when the pane opened.
 */
export function useOpenLoopsPane(): (botId: string | null | undefined) => boolean {
  const navigate = useBbNavigate();
  return useCallback((botId) => {
    if (navigate.openThreadPanel({ actionId: LOOPS_PANE, title: "Loops" })) return true;
    openLoops(botId);
    return false;
  }, [navigate]);
}

let projectNames: Promise<Map<string, string>> | null = null;

export interface LoopPeople {
  /** The primary Bot: loops belong to it (the Chief of Staff). */
  botId: string | null;
  botName: string;
  botThreadId: string | null;
  /** Lead thread id → "Kensico lead". */
  leads: ReadonlyMap<string, string>;
  /** Hand off targets: the Bot, then each project's lead (decision 9). */
  targets: { owner: string; name: string }[];
}

/** The Bot and the active project leads, named. */
export function useLoopPeople(): LoopPeople {
  const sdk = useSdk();
  const bot = useLive("bot_get", {}, { pollMs: 120_000 }).data?.bot ?? null;
  const leads = useLive("project_leads", {}, { pollMs: 120_000 }).data?.leads ?? [];
  const [projects, setProjects] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let live = true;
    projectNames ??= sdk.projects.list({ includePersonal: true })
      .then((list) => new Map((list as { id: string; name: string }[]).map(({ id, name }) => [id, name])))
      .catch(() => { projectNames = null; return new Map<string, string>(); });
    void projectNames.then((names) => { if (live) setProjects(names); });
    return () => { live = false; };
  }, [sdk]);
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
    };
  }, [bot?.id, bot?.name, bot?.threadId, leads, projects]);
}

type Act = RpcInput<"loops.act">;
type Update = RpcInput<"loops.update">;

/** loops.act and loops.update with a busy flag and the last error. */
export function useLoopActions(refresh?: () => void) {
  const call = useCall();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); refresh?.(); return true; }
    catch (cause) { setError(errorMessage(cause)); return false; }
    finally { setBusy(false); }
  }, [refresh]);
  return {
    busy,
    error,
    act: (input: Act) => run(() => call("loops.act", input)),
    update: (input: Update) => run(() => call("loops.update", input)),
  };
}

/** The phone's saved place names (loops.places), for Change trigger. */
export function usePlaceNames(enabled: boolean): string[] {
  const places = useLive("loops.places", {}, { enabled, pollMs: 300_000 });
  return places.data?.names ?? [];
}
