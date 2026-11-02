// Tabs beside a thread (SDK 0.6.104's panel tabs). Studio registers its tabs
// with `experimental_tab({ context: { kind: "thread" }, availability: "action" })`
// and opens them through the thread view's side panel
// (`experimental_useAppPanel().openTab`), which answers true or false at once.
//
// Only code inside a thread view has that panel. The sidebar, the Bot page
// and content scripts ask the thread instead (requestThreadTab): the thread's
// composer hosts ThreadTabReceiver, which opens the tab once and reports
// whether it opened. No retries.
import { experimental_useAppPanel, useComposer, type ExperimentalPanelController, type ExperimentalTabRegistration, type ExperimentalThreadTabProps, type JsonValue } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, type ComponentType } from "react";

/** One of Studio's thread tabs to open: its registration id, the tab's title, and the instance's params. */
export interface ThreadTabOpen {
  actionId: string;
  title?: string;
  params?: JsonValue;
  /**
   * An open nobody clicked for (Bot info when a Bot's chat opens): it never
   * replaces a waiting request, and is skipped while the panel already shows
   * a plugin's tab, so it can't take the panel from a tab the user opened.
   */
  background?: boolean;
}

/** The reference `openTab` takes for Studio's thread tab `id`. */
export function threadTab(id: string) {
  return { id, context: { kind: "thread" as const }, availability: "action" as const };
}

/** Opens a tab through `panel`. False when the surface has no side panel or declined. */
export function openThreadTab(panel: Pick<ExperimentalPanelController, "openTab">, open: ThreadTabOpen): boolean {
  try {
    return panel.openTab({ tab: threadTab(open.actionId), ...open.title ? { title: open.title } : {}, ...open.params !== undefined ? { params: open.params } : {} });
  } catch {
    return false;
  }
}

/** Opens one of Studio's tabs beside the thread the caller renders in. False where there's no side panel. */
export function useOpenThreadTab(): (open: ThreadTabOpen) => boolean {
  const panel = experimental_useAppPanel();
  return useCallback((open: ThreadTabOpen) => openThreadTab(panel, open), [panel]);
}

const REQUEST_EVENT = "studio:thread-tab-request";
/** How long a request waits for its thread to open before it reports false. */
const REQUEST_TIMEOUT_MS = 15_000;
const pending = new Map<string, { open: ThreadTabOpen; resolve(opened: boolean): void; timer: ReturnType<typeof setTimeout> }>();

/**
 * Asks thread `threadId` to open a tab beside it, from outside its thread
 * view. It opens when that thread's view is on screen, now or once it
 * mounts (navigate there yourself). Resolves true when the tab opened, false
 * when the thread declined or didn't open within 15 seconds. A newer request
 * for the same thread replaces this one, which resolves false.
 */
export function requestThreadTab(threadId: string, open: ThreadTabOpen): Promise<boolean> {
  const previous = pending.get(threadId);
  if (previous && open.background && !previous.open.background) return Promise.resolve(false);
  if (previous) { clearTimeout(previous.timer); pending.delete(threadId); previous.resolve(false); }
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => { if (pending.get(threadId)?.resolve === resolve) pending.delete(threadId); resolve(false); }, REQUEST_TIMEOUT_MS);
    pending.set(threadId, { open, resolve, timer });
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(REQUEST_EVENT, { detail: { threadId } }));
  });
}

/** True while thread `threadId` has a tab request waiting. */
export function hasThreadTabRequest(threadId: string): boolean {
  return pending.has(threadId);
}

/** Whether the side panel is showing a plugin's tab (one the user or a request opened). */
function showingPluginTab(panel: Partial<Pick<ExperimentalPanelController, "getTabs">>): boolean {
  try {
    const tabs = panel.getTabs?.();
    if (!tabs?.open || !tabs.selectedKey) return false;
    return tabs.tabs.find((tab) => tab.key === tabs.selectedKey)?.detail.kind === "plugin";
  } catch {
    return false;
  }
}

/** In thread `threadId`'s view: opens each tab requested for it, once. */
export function useThreadTabRequests(threadId: string | null): void {
  const panel = experimental_useAppPanel();
  useEffect(() => {
    if (!threadId) return;
    const take = () => {
      const request = pending.get(threadId);
      if (!request) return;
      pending.delete(threadId);
      clearTimeout(request.timer);
      if (request.open.background && showingPluginTab(panel)) { request.resolve(false); return; }
      request.resolve(openThreadTab(panel, request.open));
    };
    take();
    const onRequest = (event: Event) => { if ((event as CustomEvent<{ threadId?: string }>).detail?.threadId === threadId) take(); };
    window.addEventListener(REQUEST_EVENT, onRequest);
    return () => window.removeEventListener(REQUEST_EVENT, onRequest);
  }, [threadId, panel]);
}

/** A bare composer banner in every thread view that draws nothing and takes tab requests for its thread. */
export function ThreadTabReceiver() {
  const composer = useComposer();
  useThreadTabRequests(composer.scope.kind === "thread" ? composer.scope.threadId : null);
  return null;
}

/** Test hook: drops waiting requests. */
export function resetThreadTabRequests(): void {
  for (const request of pending.values()) { clearTimeout(request.timer); request.resolve(false); }
  pending.clear();
}

/** What a Studio thread tab's component gets: the thread, and the params it was opened with. */
export type ThreadTabProps = ExperimentalThreadTabProps & { params: JsonValue | null };

/**
 * Registers one of Studio's thread tabs: offered in a thread's panel
 * launcher and opened with openThreadTab or requestThreadTab by `id`.
 */
export function registerThreadTab(
  app: { slots: { experimental_tab(registration: ExperimentalTabRegistration): void } },
  tab: { id: string; title: string; icon: string; layout?: "flush" | "padded"; component: ComponentType<ThreadTabProps> },
): void {
  app.slots.experimental_tab({ ...tab, context: { kind: "thread" }, availability: "action" });
}
