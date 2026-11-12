// The canvas page as one component, the entry of the prebuilt bundle
// (build-ui.mjs → bundle/canvas-ui.js): /plugins/studio-visual-chat/canvas for a new canvas,
// /plugins/studio-visual-chat/canvas/<threadId> for one. The quick card
// (src/quick-app.tsx) loads QuickCard from the same bundle, and the window
// (src/window-app.tsx) CanvasWindow.
import { useMemo, useState } from "react";
import { CANVAS_NEW_SEGMENT } from "../shared";
import CanvasRoute, { CanvasNavContext, type CanvasNav } from "./route";

export { QuickCard } from "./quick-card";

export function CanvasPanel({ subPath }: { subPath: string }) {
  return <CanvasRoute rest={subPath.replace(/^\/+|\/+$/g, "")} />;
}

/** The chat a window opens on, from its address: `?chat=<threadId>`, `?chat=new`, or the last chat (src/window-app.tsx sets it). */
const WINDOW_CHAT_PARAM = "chat";

/**
 * The page in a window of its own (src/window-app.tsx), on a BB that opens
 * plugins in windows. The window has one address, so the page keeps which
 * chat it shows and notes it in the address, for a reload. `onOpenThread`
 * shows a chat's thread in BB's main window. The chat line has no dictation
 * mic and no hands-free button here (CanvasNav.voice). The header is the
 * window's title bar: `inset` leaves room for the macOS traffic lights, and
 * `onClose` closes the window (Cmd/Ctrl+W; a browser popup closes itself).
 */
export function CanvasWindow({ onOpenThread, onClose = () => window.close(), inset = false }: { onOpenThread(threadId: string): void; onClose?(): void; inset?: boolean }) {
  const [segment, setSegment] = useState(() => new URLSearchParams(window.location.search).get(WINDOW_CHAT_PARAM) ?? "");
  const nav = useMemo<CanvasNav>(() => ({
    open(threadId) {
      const next = threadId ?? CANVAS_NEW_SEGMENT;
      setSegment(next);
      const url = new URL(window.location.href);
      url.searchParams.set(WINDOW_CHAT_PARAM, next);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
    },
    openThread: onOpenThread,
    // Studio's dictation and hands-free live in BB's main window, not here.
    voice: false,
    window: { inset, close: onClose },
  }), [onOpenThread, onClose, inset]);
  return <div className="w-full bg-background text-foreground" style={{ height: "100dvh" }}><CanvasNavContext.Provider value={nav}><CanvasRoute rest={encodeURIComponent(segment)} /></CanvasNavContext.Provider></div>;
}
