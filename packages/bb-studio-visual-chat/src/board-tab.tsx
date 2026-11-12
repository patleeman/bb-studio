// A board as a tab beside a conversation: Visual Chat's thread action tab
// `board` (`{ threadId }`), the board's page in the workbench. BB Studio
// lists it as a kind of tab (packages/bb-studio/src/tab-kinds.ts) and opens
// it from its New Tab rows, drops and the agent's workbench_open. The tab is
// registered with `experimental_openableByPlugins`, so on the fork Studio
// opens it itself (`open({ kind: "tab", tab: { id, pluginId } })`). A BB from
// before that opens only a plugin's own tabs: there Studio asks over a window
// event (BOARD_TAB_EVENT) and this plugin's always-mounted overlay opens the
// tab through its own `useBbNavigate().experimental_workbench`.
// The opener chooses the params: the tab shows a board only for a thread id.
import { useBbNavigate, type JsonValue } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef, type ComponentType } from "react";

/** The tab's id; Studio's registry names the same one. */
export const BOARD_TAB = "board";
/** The window event Studio asks with (packages/bb-studio/src/ui/tab-open.ts PLUGIN_TAB_EVENT). */
export const BOARD_TAB_EVENT = "bb-studio:open-plugin-tab";
export const PLUGIN_ID = "studio-visual-chat";

/** What Studio sends: the tab, where to open it, and how to answer. */
export interface TabRequest {
  pluginId: string;
  tabId: string;
  params: JsonValue | null;
  title: string;
  threadId: string | null;
  options: { focus: boolean; pane?: 1 | 2 | "new"; index?: number };
  taken: boolean;
  reply(key: string | null): void;
}

/** The fork's workbench, as far as opening a tab goes; null on a BB without it or with that conversation off screen. */
export type WorkbenchOf = (threadId: string | undefined) => { open(spec: object, options: object): Promise<string | null> } | null;

export const boardThreadId = (params: JsonValue | null): string | null => {
  if (typeof params !== "object" || params === null || Array.isArray(params)) return null;
  return typeof params.threadId === "string" && /^[\w-]{1,200}$/.test(params.threadId) ? params.threadId : null;
};

/** Takes a request meant for this plugin's board tab, at once, and answers with the opened tab's key. False for anyone else's. */
export function takeTabRequest(request: TabRequest, workbenchOf: WorkbenchOf): boolean {
  if (request.pluginId !== PLUGIN_ID || request.tabId !== BOARD_TAB || !boardThreadId(request.params)) return false;
  request.taken = true;
  const wb = workbenchOf(request.threadId ?? undefined);
  if (!wb) { request.reply(null); return true; }
  wb.open({ kind: "tab", tab: { id: BOARD_TAB }, params: request.params, title: request.title }, request.options)
    .then((key) => request.reply(key), () => request.reply(null));
  return true;
}

/** Always mounted: answers Studio's requests to open a board as a tab. Draws nothing. */
export function BoardTabRequests() {
  const navigate = useBbNavigate();
  const latest = useRef(navigate);
  latest.current = navigate;
  useEffect(() => {
    const workbenchOf: WorkbenchOf = (threadId) => {
      const method = (latest.current as { experimental_workbench?: WorkbenchOf }).experimental_workbench;
      try { return typeof method === "function" ? method.call(latest.current, threadId) ?? null : null; } catch { return null; }
    };
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<TabRequest>).detail;
      if (detail && typeof detail === "object") takeTabRequest(detail, workbenchOf);
    };
    window.addEventListener(BOARD_TAB_EVENT, onRequest);
    return () => window.removeEventListener(BOARD_TAB_EVENT, onRequest);
  }, []);
  return null;
}

/** The tab: the board's page for its thread. */
export function boardTab(Page: ComponentType<{ subPath: string }>) {
  return function BoardTab({ params }: { params: JsonValue | null }) {
    const threadId = boardThreadId(params);
    if (!threadId) return null;
    return <div className="flex h-full min-h-0 flex-col" data-testid="visual-chat-board-tab"><Page subPath={encodeURIComponent(threadId)} /></div>;
  };
}

/**
 * Registers the tab, for other plugins to open (`experimental_openableByPlugins`)
 * and off BB's New Tab page, and the overlay that answers an older BB's
 * requests. False, with nothing registered, on a BB without action tabs.
 */
export function registerBoardTab(slots: object, Page: ComponentType<{ subPath: string }>, icon: string): boolean {
  const target = slots as { experimental_tab?: (tab: object) => void; experimental_appOverlay?: (overlay: object) => void };
  if (typeof target.experimental_tab !== "function") return false;
  target.experimental_tab({
    id: BOARD_TAB, context: { kind: "thread" }, availability: "action", title: "Visual Chat board", icon, layout: "flush", component: boardTab(Page),
    experimental_showInNewTab: false, experimental_openableByPlugins: true,
  });
  target.experimental_appOverlay?.({ id: "board-tab-requests", component: BoardTabRequests });
  return true;
}
