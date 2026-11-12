// Opening a workbench tab beside the Studio page from outside it (a drop on
// BB's workbench, the Global item opener). The Studio page hosts
// PageTabReceiver, which opens what is asked for in its own side
// panel and says whether it opened. A thread's workbench has the same thing
// in src/kit/app/thread-panel.tsx.
import { experimental_useAppPanel } from "@get-bb/plugin-sdk/app";
import { useEffect, type ComponentType } from "react";
import { openPageTab, type WorkbenchOpen } from "../kit/app/workbench";
import { useWorkbenchCloseRequests } from "../kit/app/workbench-close";

const REQUEST_EVENT = "studio:page-tab-request";
const TIMEOUT_MS = 3_000;
const waiting: { open: WorkbenchOpen; resolve(opened: boolean): void }[] = [];

/** Asks the Studio page on screen to open `open` beside it. False when no Studio page took it. */
export function requestPageTab(open: WorkbenchOpen): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const request = { open, resolve };
    waiting.push(request);
    setTimeout(() => { const at = waiting.indexOf(request); if (at >= 0) { waiting.splice(at, 1); resolve(false); } }, TIMEOUT_MS);
    if (typeof window !== "undefined") window.dispatchEvent(new Event(REQUEST_EVENT));
  });
}

/** In the Studio page: opens each requested tab in the page's side panel. Draws nothing. */
export function PageTabReceiver({ panelId }: { panelId?: string }) {
  const panel = experimental_useAppPanel();
  // A tab dragged out of the Studio page's workbench closes here.
  useWorkbenchCloseRequests(null);
  useEffect(() => {
    const take = () => { for (const request of waiting.splice(0)) request.resolve(openPageTab(panel, request.open, panelId)); };
    take();
    window.addEventListener(REQUEST_EVENT, take);
    return () => window.removeEventListener(REQUEST_EVENT, take);
  }, [panel, panelId]);
  return null;
}

/** A nav panel that also takes page tab requests. */
export function withPageTabs<Props extends object>(Component: ComponentType<Props>, panelId?: string): ComponentType<Props> {
  return function PanelWithPageTabs(props: Props) {
    return <><PageTabReceiver panelId={panelId} /><Component {...props} /></>;
  };
}

/** Test hook: drops waiting requests. */
export function resetPageTabRequests(): void {
  for (const request of waiting.splice(0)) request.resolve(false);
}
