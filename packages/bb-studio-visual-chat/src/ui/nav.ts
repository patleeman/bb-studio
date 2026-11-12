// How the canvas page moves between chats, and what it knows about the
// place it is drawn in: BB's main view, or a window of its own.
import { createContext } from "react";
import { canvasHref, canvasNewHref } from "../shared";
import { openAppPath } from "./studio";

/**
 * How the page moves between chats. In BB's main view each chat has its own
 * address under the panel. In a window of its own (panel.tsx CanvasWindow)
 * the page keeps the chat itself, and can ask BB's main window to show the
 * chat's thread.
 */
export interface CanvasNav {
  /** Shows a chat; null is a new one. */
  open(threadId: string | null, options?: { replace?: boolean }): void;
  /** "Open thread in BB", where the page is not in BB's main view. */
  openThread?(threadId: string): void;
  /**
   * False where the dictation mic and the hands-free button can't work, so
   * they are not drawn: both belong to Studio, which answers their events
   * from overlays it mounts in BB's main window only. A window of the
   * plugin's own is another document, with none of Studio in it.
   */
  voice?: boolean;
  /**
   * Set where the page is a window of its own: the header is then the
   * window's title bar (one draggable row) and the window's shortcuts are on.
   */
  window?: {
    /** True in the macOS desktop app: the traffic lights sit in the header's top-left, so it starts after them. */
    inset: boolean;
    close(): void;
  };
}

export const PAGE_NAV: CanvasNav = { open: (threadId, options) => openAppPath(threadId ? canvasHref(threadId) : canvasNewHref(), options) };
export const CanvasNavContext = createContext<CanvasNav>(PAGE_NAV);
