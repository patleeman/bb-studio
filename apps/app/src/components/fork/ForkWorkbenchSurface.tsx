import { useContext, useLayoutEffect, useRef } from "react";
import { useStore } from "jotai";
import { useAppNavigationHost } from "@/lib/app-navigation-host";
import {
  registerWorkbenchSurface,
  type WorkbenchSurface,
} from "@/lib/fork-workbench";
import { InAppBrowserUrlOpenContext } from "@/lib/url-open-routing";

export function ForkWorkbenchSurface({
  threadId,
  panelStateId = threadId,
}: {
  threadId: string;
  panelStateId?: string;
}) {
  const host = useAppNavigationHost();
  const openInAppBrowser = useContext(InAppBrowserUrlOpenContext);
  const store = useStore();
  const latest = useRef<WorkbenchSurface | null>(null);
  useLayoutEffect(() => {
    latest.current = {
      threadId,
      panelStateId,
      panel: host.panel,
      openFilePreview: host.openFilePreview,
      openTerminal: host.openTerminal,
      openInAppBrowser,
      store,
    };
  });
  useLayoutEffect(() => registerWorkbenchSurface(() => latest.current), []);
  return null;
}
