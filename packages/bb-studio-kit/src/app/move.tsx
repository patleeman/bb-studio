// Opening a Studio item or a thread wherever the user asked: the main view,
// the floating panel, or a split pane. One hook, so every menu, click and
// drop moves things the same way.
import { experimental_useSidebarThreadActions, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useRef, type ReactNode } from "react";
import { openFloat } from "./float";
import type { FloatTarget } from "./float-registry";
import { openAppPath } from "./nav";
import { openPathInSplit } from "./studio-item";

export type OpenPlace = "main" | "float" | "split";

/**
 * `open(target, place)`, with Float falling back to the main view when Float
 * isn't running and a split falling back when BB doesn't split (a small
 * screen, or splits turned off). Render `anchor` once: BB splits a path only
 * from a link in the calling plugin's own tree.
 */
export function useOpenTarget(): { open(target: FloatTarget, place: OpenPlace): void; anchor: ReactNode } {
  const navigate = useBbNavigate();
  const threads = experimental_useSidebarThreadActions();
  const link = useRef<HTMLAnchorElement>(null);
  const open = (target: FloatTarget, place: OpenPlace) => {
    if (place === "float" && openFloat(target)) return;
    if (target.kind === "thread") {
      if (place === "split") threads.open(target.threadId, { split: true });
      else navigate.toThread(target.threadId);
      return;
    }
    if (place === "split" && openPathInSplit(link.current, target.path)) return;
    openAppPath(target.path, { main: true });
  };
  return { open, anchor: <a ref={link} aria-hidden tabIndex={-1} className="hidden" /> };
}
