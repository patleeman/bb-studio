import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@bb/shared-ui/button";
import { cn } from "@bb/shared-ui/lib/utils";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { getEnvironmentFilePreviewSourceAtRef } from "@bb/client-core";
import { PluginPanelTabContent } from "@/components/plugin/PluginPanelActions";
import {
  LazyHostScopedFilePreviewTabContent,
  LazyThreadStorageFilePreviewTabContent,
  LazyWorkspaceFilePreviewTabContent,
} from "@/components/secondary-panel/lazySecondaryPanelComponents";
import { useThread } from "@/hooks/queries/thread-queries";
import {
  getBbDesktopInfo,
  MACOS_APP_REGION_NO_DRAG_CLASS,
  MACOS_TRAFFIC_LIGHT_RESERVE_PADDING_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  shouldUseMacosDesktopChrome,
} from "@/lib/bb-desktop";
import {
  parseTabWindowSearch,
  type TabWindowRequest,
} from "@/lib/fork-tab-popout";
import { requestTabReturn } from "@/lib/fork-tab-return";
import { TabWindowContext } from "@/lib/fork-tab-window";
import { toFilePreviewLineRange } from "@/lib/live-file-navigation";

function TabWindowContent({
  request,
  environmentId,
}: {
  request: TabWindowRequest;
  environmentId: string | null;
}) {
  const { spec, threadId } = request;
  const environment = useMemo(
    () => (environmentId === null ? null : { id: environmentId }),
    [environmentId],
  );
  if (spec.kind === "tab") {
    return (
      <PluginPanelTabContent
        tab={{
          id: "fork-tab-window",
          kind: "plugin-panel",
          actionId: spec.tab.id,
          pluginId: spec.tab.pluginId ?? "",
          paramsJson:
            spec.params === undefined ? null : JSON.stringify(spec.params),
          title: spec.title ?? request.title,
        }}
        context={{ kind: "thread", threadId, environment }}
      />
    );
  }
  if (spec.kind !== "file") return null;
  const lineRange = toFilePreviewLineRange(spec.location ?? null);
  const { target } = spec;
  switch (target.kind) {
    case "workspace":
      return (
        <LazyWorkspaceFilePreviewTabContent
          activePath={target.path}
          environmentId={target.environmentId}
          isPanelOpen
          lineRange={lineRange}
          source={getEnvironmentFilePreviewSourceAtRef(target.experimental_ref)}
          threadId={threadId}
        />
      );
    case "host":
      return (
        <LazyHostScopedFilePreviewTabContent
          activePath={target.path}
          hostId={target.hostId}
          isPanelOpen
          lineRange={lineRange}
        />
      );
    case "thread-storage":
      return (
        <LazyThreadStorageFilePreviewTabContent
          activePath={target.path}
          isPanelOpen
          lineRange={lineRange}
          threadId={target.threadId}
        />
      );
  }
}

export function ForkTabWindow() {
  const [search] = useSearchParams();
  const request = useMemo(() => parseTabWindowSearch(search), [search]);
  const thread = useThread(request?.threadId ?? "", {
    enabled: request !== null,
  }).data;
  const [state, setState] = useState<"idle" | "pending" | "failed">("idle");
  const [toolbar, setToolbar] = useState<HTMLElement | null>(null);
  const title = request?.title ?? "";
  const tabWindow = useMemo(() => ({ title, toolbar }), [title, toolbar]);
  const macChrome = shouldUseMacosDesktopChrome(getBbDesktopInfo());

  useEffect(() => {
    if (request !== null && request.title !== "")
      document.title = request.title;
  }, [request]);

  if (request === null) return null;

  const returnToWorkbench = () => {
    setState("pending");
    void requestTabReturn({
      threadId: request.threadId,
      projectId: thread?.projectId ?? null,
      spec: request.spec,
      pane: request.pane,
      from: request.from,
    }).then((ok) => {
      if (ok) window.close();
      else setState("failed");
    });
  };

  return (
    <TooltipProvider delayDuration={300} disableHoverableContent>
      <div
        data-fork-tab-window=""
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
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">
            {request.title}
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
          <TabWindowContext.Provider value={tabWindow}>
            <TabWindowContent
              request={request}
              environmentId={thread?.environmentId ?? null}
            />
          </TabWindowContext.Provider>
        </div>
      </div>
    </TooltipProvider>
  );
}
