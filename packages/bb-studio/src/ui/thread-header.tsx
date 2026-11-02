// Studio's buttons in a thread's header. SDK 0.6.104 removed the header slot
// that drew Studio's own components; a header button is now a thread action
// with `placement: "header"`, which BB draws as a labelled outline button
// (several share one split button, folded into the thread menu when narrow).
// Each registration's `useData` runs once for the app with the threads whose
// header is on screen; `item` decides per thread.
import type { PluginAppBuilder, PluginThreadActionRegistration } from "@get-bb/plugin-sdk/app";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { openAppPath } from "../kit/app/index";
import { openThreadTab } from "../kit/app/thread-panel";
import { untitled } from "../kit/format";
import { LOOPS_PANE, openLoops, useLoopsEnabled } from "../loops/ui/hooks";
import { useNeedsYou } from "../loops/ui/LoopsTab";
import { pagePath } from "../pages/constants";
import type { PageMetaView, rpcContract as pagesContract } from "../pages/contract";
import { useCall, useLive } from "./live";
import { BOT_INFO_ACTION } from "./bot/workspace";
import { botPath } from "./bot/selection";

/** Header actions sort among themselves by group. */
const HEADER_GROUP = "studio";
const LOOKUP_POLL_MS = 120_000;

/**
 * One value per thread whose header is on screen, loaded with `load` for ids
 * not loaded yet and refreshed every `pollMs`. A failed load reads as null.
 */
export function useThreadLookup<T>(threadIds: readonly string[], load: (threadId: string) => Promise<T | null>, options: { enabled?: boolean; pollMs?: number } = {}): ReadonlyMap<string, T | null> {
  const { enabled = true, pollMs = LOOKUP_POLL_MS } = options;
  const [values, setValues] = useState<ReadonlyMap<string, T | null>>(() => new Map());
  const loaded = useRef(new Set<string>());
  const key = threadIds.join("\n");
  useEffect(() => {
    if (!enabled || !key) return;
    let stopped = false;
    const ids = key.split("\n");
    const fetch = (all: boolean) => {
      for (const id of ids) {
        if (!all && loaded.current.has(id)) continue;
        loaded.current.add(id);
        const settle = (value: T | null) => { if (!stopped) setValues((previous) => previous.get(id) === value ? previous : new Map(previous).set(id, value)); };
        load(id).then(settle, () => settle(null));
      }
    };
    fetch(false);
    const timer = setInterval(() => fetch(true), pollMs);
    return () => { stopped = true; clearInterval(timer); };
  }, [key, enabled, load, pollMs]);
  return values;
}

/** Whether each shown thread belongs to a Bot (its chat or a thread it started). */
function useBotOwners(threadIds: readonly string[]) {
  const call = useCall();
  const load = useCallback(async (threadId: string) => (await call("bot_thread_owner", { threadId })).botId ?? null, [call]);
  return useThreadLookup(threadIds, load);
}

/** "Bot info" on a Bot's threads: the Bot's Info in a tab beside the chat. */
export const botInfoHeaderAction: PluginThreadActionRegistration<ReadonlyMap<string, string | null>> = {
  id: "bot-info",
  title: "Bot info",
  icon: "Bot",
  group: HEADER_GROUP,
  order: 2,
  placement: "header",
  useData: ({ threadIds }) => useBotOwners(threadIds),
  item: ({ thread, data, experimental_panel }) => {
    const botId = data.get(thread.id);
    if (!botId) return null;
    return {
      label: "Bot info",
      icon: "Bot",
      run: () => { if (!openThreadTab(experimental_panel, { actionId: BOT_INFO_ACTION, title: "Bot info" })) openAppPath(botPath(botId)); },
    };
  },
};

interface LoopsHeaderData { botId: string; threadId: string; needs: number }

/**
 * "Loops" on the primary Bot's chat while the Attention Router is on: the
 * Loops pane beside the chat, labelled with what needs Patrick now. Where the
 * pane can't open, it says so and opens the Loops page instead.
 */
export const loopsHeaderAction: PluginThreadActionRegistration<LoopsHeaderData | null> = {
  id: "loops-pane",
  title: "Loops",
  icon: "ListTodo",
  group: HEADER_GROUP,
  order: 1,
  placement: "header",
  useData: ({ threadIds }) => {
    const enabled = useLoopsEnabled();
    const bot = useLive("bot_get", {}, { enabled, pollMs: LOOKUP_POLL_MS }).data?.bot ?? null;
    const chatId = enabled && bot?.threadId && threadIds.includes(bot.threadId) ? bot.threadId : null;
    const list = useLive("loops.list", {}, { enabled: !!chatId, pollMs: 60_000 });
    const needs = useNeedsYou(chatId ? bot!.id : null, chatId, list.data?.needsYouNow).count;
    return chatId ? { botId: bot!.id, threadId: chatId, needs } : null;
  },
  item: ({ thread, data, experimental_panel }) => {
    if (!data || thread.id !== data.threadId) return null;
    const { botId, needs } = data;
    return {
      label: needs ? `Loops · ${needs}` : "Loops",
      ...needs ? { detail: `${needs} need${needs === 1 ? "s" : ""} you now` } : {},
      icon: "ListTodo",
      run: () => {
        if (openThreadTab(experimental_panel, { actionId: LOOPS_PANE, title: "Loops" })) return;
        toast.error("Couldn’t open Loops beside the chat, so it opened as a page.");
        openLoops(botId);
      },
    };
  },
};

/** In a thread started from "Work with this page", the page's name: back to the page. */
export const pageLinkHeaderAction: PluginThreadActionRegistration<ReadonlyMap<string, PageMetaView | null>> = {
  id: "page-link",
  title: "Page",
  icon: "FileText",
  group: HEADER_GROUP,
  order: 3,
  placement: "header",
  useData: ({ threadIds }) => {
    const rpc = useRpc<typeof pagesContract>();
    const load = useCallback(async (threadId: string) => (await rpc.call("pages.chatPage", { threadId })).page ?? null, [rpc]);
    return useThreadLookup(threadIds, load);
  },
  item: ({ thread, data }) => {
    const page = data.get(thread.id);
    if (!page) return null;
    const title = untitled(page.title);
    return {
      label: title.length > 40 ? `${title.slice(0, 39).trimEnd()}…` : title,
      detail: "Open the page this thread works on",
      icon: "FileText",
      run: () => openAppPath(`${pagePath(page.id)}/chat/${encodeURIComponent(thread.id)}`),
    };
  },
};

/** Registers Studio's header buttons; Page only while Pages is on. */
export function registerThreadHeader(app: PluginAppBuilder, options: { pages: boolean }): void {
  app.slots.experimental_threadAction(loopsHeaderAction);
  app.slots.experimental_threadAction(botInfoHeaderAction);
  if (options.pages) app.slots.experimental_threadAction(pageLinkHeaderAction);
}
