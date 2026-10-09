// Opening a Studio item or a thread where the user asked: the main view or
// a split pane. One hook, so every menu, click and drop opens things the
// same way.
import { experimental_useSidebarThreadActions, useBbNavigate, useSdk } from "@get-bb/plugin-sdk/app";
import { useRef, type ReactNode } from "react";
import { STUDIO_PLUGIN_ID } from "../contract";
import { z } from "zod";
import { openAppPath } from "./nav";
import { openWorkspaceItem } from "./workspace";
import { openPathInSplit } from "./studio-item";

/** What opens: a thread, or an in-app path such as an item's href. */
export type OpenTarget =
  | { kind: "thread"; threadId: string; title?: string }
  | { kind: "path"; path: string; title?: string; icon?: string };

export type OpenPlace = "main" | "split";

/** Opens a thread or a path in the main view, where the sidebar lists it. */
export function useOpenMain(): (target: OpenTarget) => void {
  const navigate = useBbNavigate();
  return (target) => target.kind === "thread" ? navigate.toThread(target.threadId) : openAppPath(target.path);
}

/**
 * `open(target, place)`, with a split falling back to the main view when BB
 * doesn't split (a small screen, or splits turned off). Render `anchor` once:
 * BB splits a path only from a link in the calling plugin's own tree.
 */
export function useOpenTarget(): { open(target: OpenTarget, place: OpenPlace): void; anchor: ReactNode } {
  const navigate = useBbNavigate();
  const threads = experimental_useSidebarThreadActions();
  const sdk = useSdk();
  const link = useRef<HTMLAnchorElement>(null);
  const open = (target: OpenTarget, place: OpenPlace) => {
    if (target.kind === "thread") {
      if (place === "split") threads.open(target.threadId, { split: true });
      else navigate.toThread(target.threadId);
      return;
    }
    if (openWorkspaceItem({ href: target.path, title: target.title }, place === "split" ? "right" : "tab")) return;
    if (place === "split" && openPathInSplit(link.current, target.path)) {
      // The sidebar lists what the main view shows; a split's item is listed too.
      void sdk.plugins.callRpc({ pluginId: STUDIO_PLUGIN_ID, method: "visitTab", input: { path: target.path } as never, outputSchema: z.unknown() }).catch(() => {});
      return;
    }
    openAppPath(target.path);
  };
  return { open, anchor: <a ref={link} aria-hidden tabIndex={-1} className="hidden" /> };
}
