import { useContext, useLayoutEffect, useRef } from "react";
import { useStore } from "jotai";
import { useAppNavigationHost } from "@/lib/app-navigation-host";
import {
  pageWorkbenchKey,
  registerWorkbenchSurface,
  type WorkbenchSurface,
} from "@/lib/fork-workbench";
import { InAppBrowserUrlOpenContext } from "@/lib/url-open-routing";

export function ForkWorkbenchSurface({
  threadId,
  panelStateId = threadId,
  page,
}: {
  threadId: string;
  panelStateId?: string;
  page?: WorkbenchSurface["page"];
}) {
  const host = useAppNavigationHost();
  const openInAppBrowser = useContext(InAppBrowserUrlOpenContext);
  const store = useStore();
  const latest = useRef<WorkbenchSurface | null>(null);
  useLayoutEffect(() => {
    latest.current = {
      threadId,
      panelStateId,
      ...(page === undefined ? {} : { page }),
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

export function forkPageWorkbenchSurface(
  pluginId: string,
  panelId: string,
  panelStateId: string,
) {
  const key = pageWorkbenchKey(pluginId, panelId);
  return (
    <ForkWorkbenchSurface
      key={key}
      threadId={key}
      panelStateId={panelStateId}
      page={{ pluginId, panelId }}
    />
  );
}
