// BB Studio Visual Chat (prototype): its page in BB's rail, /plugins/studio-visual-chat/canvas for the
// last canvas, /plugins/studio-visual-chat/canvas/new for a new one and /plugins/studio-visual-chat/canvas/<threadId>
// for one. On a BB that opens plugins in windows it is also an app window (src/window-app.tsx): the page's
// header has "Open in window". The page is prebuilt into bundle/canvas-ui.js (build-ui.mjs) because it reuses
// Studio's widget renderers, whose npm imports BB's install-time build can't reach.
import { definePluginApp, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { lazy, Suspense } from "react";
import "./src/ui/canvas.css";
import { registerQuickCard } from "./src/quick-app";
import { createQuickStore } from "./src/ui/quick-store";
import { registerWindowApp, WINDOW_ICON, type WindowApp } from "./src/window-app";
import { registerBoardTab } from "./src/board-tab";

const CanvasPanel = lazy(() => import("./bundle/canvas-ui.js").then((module) => ({ default: module.CanvasPanel })));

function Panel({ subPath }: PluginNavPanelProps) {
  return <Suspense fallback={null}><CanvasPanel subPath={subPath} /></Suspense>;
}

/** The page header's "Open in window": the chat on screen, in Visual Chat's window. */
export function openInWindowButton(windowApp: WindowApp) {
  return function OpenInWindow({ subPath }: PluginNavPanelProps) {
    return (
      <button type="button" data-canvas-open-window="" title="Open in window" onClick={() => windowApp.openPage(subPath)}
        className="ml-auto flex shrink-0 items-center rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        Open in window
      </button>
    );
  };
}

export default definePluginApp((app) => {
  // Its window, where BB has plugin windows.
  const windowApp = registerWindowApp(app);
  // The page, with a window: its header opens the chat there. Off the rail and the command palette
  // (`experimental_hideFromNavigation: true`, only where BB has plugin windows: stock BB refuses a panel with a field it doesn't know, and keeps it in the rail): BB Studio opens it from its launcher.
  const offRail: object = windowApp ? { experimental_hideFromNavigation: true } : {};
  app.slots.navPanel({ id: "canvas", title: "Visual Chat", icon: WINDOW_ICON, path: "canvas", component: Panel, ...(windowApp ? { headerContent: openInWindowButton(windowApp) } : {}), ...offRail });
  // A board as a tab beside a conversation (src/board-tab.tsx): BB Studio opens it from its New Tab rows, drops and the
  // agent's workbench_open, with the fork's workbench API (`experimental_openableByPlugins` lets it), or on an older BB
  // by asking this plugin's overlay.
  registerBoardTab(app.slots, Panel, WINDOW_ICON);
  // The quick card and its "Visual Chat: Ask" shortcut (src/quick-app.tsx). Its expand opens the full page: the window, where there is one.
  registerQuickCard(app, windowApp ? createQuickStore({ expandTo: windowApp.openChat }) : undefined);
});
