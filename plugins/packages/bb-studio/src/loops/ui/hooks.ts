// What a to-do's tab (TodoTab.tsx) and card (src/tasks/ui/TaskCard.tsx)
// read besides the to-do: the people it can belong to, and its actions.
import { useBbNavigate, useSdk } from "@get-bb/plugin-sdk/app";
import { useStudioSettings } from "../../settings/ui/use-settings";
import { useCallback, useEffect, useMemo, useState } from "react";
import { errorMessage } from "../../kit/format";
import { useCall, useLive, type RpcInput } from "../../ui/live";
import { toast } from "sonner";
import { threadComposer } from "../../kit/composer";
import type { Loop } from "../contract";
import { LOOP_MENTION } from "../reference";

const PERSONAL_PROJECT_ID = "proj_personal";

export function useTodosZone(): string | undefined {
  const { timeZone } = useStudioSettings();
  return timeZone ?? undefined;
}

/** The old Todos pane's thread tab id; the Strands page shows in it now (src/ui/tab-kind-tabs.tsx). */
export const LOOPS_PANE = "loops";

const CHIP_LENGTH = 60;
const chipLabel = (title: string) => { const line = title.replace(/\s+/g, " ").trim(); return line.length > CHIP_LENGTH ? `${line.slice(0, CHIP_LENGTH - 1).trimEnd()}…` : line; };

/**
 * Discuss: the todo as an `@loop` chip at the end of the Bot chat's draft,
 * not sent, with the caret after it, so the user types their question. The Bot
 * gets the todo's id, title, why and trigger when they send (reference.ts).
 * Away from the chat (the Todos tab), it opens the chat first and waits for
 * its composer. True when the chip went in. From a menu, pass `focus: false`
 * and focus the composer (focusDiscussed) once the menu has closed, or the
 * menu's focus trap takes it back.
 */
export function useDiscussLoop(botThreadId: string | null, botName: string): (loop: Pick<Loop, "id" | "title">, options?: { focus?: boolean }) => Promise<boolean> {
  const navigate = useBbNavigate();
  return useCallback(async (loop, { focus = true } = {}) => {
    if (!botThreadId) { toast.error(`Start a chat with ${botName} to discuss a task.`); return false; }
    let composer = threadComposer(botThreadId);
    if (!composer) {
      navigate.toThread(botThreadId);
      for (let tries = 0; !composer && tries < 30; tries += 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        composer = threadComposer(botThreadId);
      }
    }
    if (!composer) { toast.error(`Couldn’t reach the chat with ${botName}. Open it and try again.`); return false; }
    try {
      composer.insert([{ provider: LOOP_MENTION, id: loop.id, label: chipLabel(loop.title) }, " "], { at: "end" });
      if (focus) composer.focus();
      return true;
    } catch (error) {
      toast.error(`Couldn’t add it to the chat: ${errorMessage(error)}`);
      return false;
    }
  }, [navigate, botThreadId, botName]);
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
