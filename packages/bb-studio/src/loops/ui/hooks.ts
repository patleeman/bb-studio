// What the loop UI reads besides the loops: whether the Attention Router is
// on, the people a loop can belong to, and the actions it takes.
import { useBbNavigate, useSdk, useSettings } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useMemo, useState } from "react";
import { errorMessage } from "../../kit/format";
import { openAppPath } from "../../kit/app/index";
import { useCall, useLive, type RpcInput } from "../../ui/live";
import { botPath } from "../../ui/bot/selection";
import { toast } from "sonner";
import { threadComposer } from "../../kit/composer";
import type { Loop } from "../contract";
import { LOOP_MENTION, loopReference } from "../reference";

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

const PANE_EVENT = "studio:loops-pane";
/** The chat asked to open the Loops pane, until its header action does. */
let paneWanted: string | null = null;

/**
 * Asks the Bot chat `threadId` to open the Loops pane beside it, from outside
 * its thread view (the sidebar): openThreadPanel only works reliably from
 * inside it, so the chat's Loops header button opens it, now or when the
 * chat opens (useLoopsPaneRequests).
 */
export function requestLoopsPane(threadId: string): void {
  paneWanted = threadId;
  window.dispatchEvent(new Event(PANE_EVENT));
}

/** In the chat `threadId`'s header: runs `open` for each request for it. A declined open is retried briefly while the view mounts. */
export function useLoopsPaneRequests(threadId: string, open: () => boolean): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const take = () => {
      if (paneWanted !== threadId) return;
      paneWanted = null;
      let tries = 0;
      const attempt = () => { if (!open() && ++tries < 6) timer = setTimeout(attempt, 300); };
      attempt();
    };
    take();
    window.addEventListener(PANE_EVENT, take);
    return () => { window.removeEventListener(PANE_EVENT, take); clearTimeout(timer); };
  }, [threadId, open]);
}

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

const CHIP_LENGTH = 60;
const chipLabel = (title: string) => { const line = title.replace(/\s+/g, " ").trim(); return line.length > CHIP_LENGTH ? `${line.slice(0, CHIP_LENGTH - 1).trimEnd()}…` : line; };

/**
 * Discuss: the loop as an `@loop` chip at the end of the Bot chat's draft,
 * not sent, with the caret after it, so Patrick types his question. The Bot
 * gets the loop's id, title, why and trigger when he sends (reference.ts).
 * Away from the chat (the Loops tab), it opens the chat first and waits for
 * its composer. True when the chip went in. From a menu, pass `focus: false`
 * and focus the composer (focusDiscussed) once the menu has closed, or the
 * menu's focus trap takes it back.
 */
export function useDiscussLoop(botThreadId: string | null, botName: string): (loop: Pick<Loop, "id" | "title">, options?: { focus?: boolean }) => Promise<boolean> {
  const navigate = useBbNavigate();
  return useCallback(async (loop, { focus = true } = {}) => {
    if (!botThreadId) { toast.error(`Start a chat with ${botName} to discuss a loop.`); return false; }
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

/** The caret at the end of the Bot chat's draft, after Discuss from a menu. */
export function focusDiscussed(botThreadId: string | null): void {
  if (botThreadId) threadComposer(botThreadId)?.focus();
}

/** A row's drag: the loop's reference as plain text, which BB's composer inserts where it's dropped. The row is marked `data-dragging` meanwhile. */
export function loopDragProps(loop: Pick<Loop, "id" | "title">) {
  return {
    draggable: true,
    onDragStart: (event: { currentTarget: HTMLElement; dataTransfer: DataTransfer | null }) => {
      if (!event.dataTransfer) return;
      event.dataTransfer.setData("text/plain", loopReference(loop));
      event.dataTransfer.effectAllowed = "copy";
      event.currentTarget.dataset.dragging = "";
    },
    onDragEnd: (event: { currentTarget: HTMLElement }) => { delete event.currentTarget.dataset.dragging; },
  };
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
