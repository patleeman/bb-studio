import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import { cn } from "@bb/shared-ui/lib/utils";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { useThread } from "@/hooks/queries/thread-queries";
import {
  getBbDesktopInfo,
  MACOS_APP_REGION_NO_DRAG_CLASS,
  MACOS_TRAFFIC_LIGHT_RESERVE_PADDING_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import type { FixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import {
  closeTabWindow,
  paneOfTab,
  parseTabWindowSearch,
  tabOpenSpec,
  type TabWindowPane,
  type TabWindowRequest,
} from "@/lib/fork-tab-popout";
import { requestTabReturn, type ReturnedTab } from "@/lib/fork-tab-return";
import { tabWindowPanelStateId } from "@/lib/fork-tab-window-panel";
import { workbenchSplitsFor } from "@/components/secondary-panel/workbenchSplits.fork";
import {
  ForkTabWindowPanel,
  type TabWindowPanelState,
} from "./ForkTabWindowPanel";

export async function returnedTabsOf(
  request: TabWindowRequest,
  tabs: readonly FixedPanelTab[],
): Promise<ReturnedTab[]> {
  const panelStateId = tabWindowPanelStateId(
    request.threadId,
    request.windowId,
  );
  const paneCount = workbenchSplitsFor(panelStateId)?.panes().length ?? 1;
  const returned: ReturnedTab[] = [];
  for (const tab of tabs) {
    const spec = await tabOpenSpec(tab, request.threadId);
    if (spec === null) continue;
    const pane: TabWindowPane =
      paneCount < 2 ? request.pane : paneOfTab(panelStateId, tab.id);
    returned.push({ spec, pane });
  }
  return returned;
}

export function ForkTabWindow() {
  const [search] = useSearchParams();
  const request = useMemo(() => parseTabWindowSearch(search), [search]);
  const thread = useThread(request?.threadId ?? "", {
    enabled: request !== null,
  }).data;
  const [state, setState] = useState<"idle" | "pending" | "failed">("idle");
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null);
  const [panelState, setPanelState] = useState<TabWindowPanelState | null>(
    null,
  );
  const macChrome = shouldUseMacosDesktopChrome(getBbDesktopInfo());
  const title = panelState?.activeTitle ?? request?.title ?? "";

  useEffect(() => {
    if (title !== "") document.title = title;
  }, [title]);

  const closeWindow = useCallback(() => {
    if (request !== null) void closeTabWindow(request.windowId);
  }, [request]);

  if (request === null) return null;

  const returnToWorkbench = () => {
    setState("pending");
    void returnedTabsOf(request, panelState?.tabs ?? [])
      .then((tabs) =>
        requestTabReturn({
          threadId: request.threadId,
          projectId: thread?.projectId ?? null,
          tabs,
          from: request.from,
        }),
      )
      .then((ok) => {
        if (ok) closeWindow();
        else setState("failed");
      });
  };

  return (
    <TooltipProvider delayDuration={300} disableHoverableContent>
      <div
        data-fork-tab-window=""
        data-fork-tab-window-tabs={
          panelState === null || panelState.tabCount === 1 ? "one" : "many"
        }
        className="flex h-dvh w-dvw flex-col overflow-hidden bg-background"
      >
        <header
          className={cn(
            "flex h-10 shrink-0 items-center gap-2 border-b border-border pr-2",
            macChrome
              ? cn(
                  MACOS_WINDOW_DRAG_CLASS,
                  MACOS_TRAFFIC_LIGHT_RESERVE_PADDING_CLASS,
                )
              : "pl-3",
          )}
        >
          <span
            className="min-w-0 flex-1 truncate text-sm text-foreground"
            data-fork-tab-window-title=""
          >
            {title}
          </span>
          <div
            ref={setToolbar}
            data-fork-tab-window-toolbar=""
            className={cn(
              "flex min-w-0 shrink-0 items-center gap-1 empty:hidden",
              MACOS_APP_REGION_NO_DRAG_CLASS,
            )}
          />
          {state === "failed" ? (
            <span role="status" className="shrink-0 text-xs text-destructive">
              Conversation not open
            </span>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className={MACOS_APP_REGION_NO_DRAG_CLASS}
            disabled={state === "pending"}
            onClick={returnToWorkbench}
            data-fork-tab-return=""
          >
            Return to workbench
          </Button>
        </header>
        <div className="relative flex min-h-0 flex-1 flex-col">
          <ForkTabWindowPanel
            request={request}
            environmentId={thread?.environmentId ?? null}
            toolbar={toolbar}
            onState={setPanelState}
            onEmpty={closeWindow}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}
