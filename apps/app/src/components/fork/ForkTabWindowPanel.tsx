import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { PanelGroup } from "react-resizable-panels";
import type { TerminalSession } from "@bb/server-contract";
import { AppPanelTabsPublisher } from "@/lib/app-panel-tabs";
import { useAppPanelController } from "@/lib/app-fixed-tab-navigation";
import { AppNavigationHostProvider } from "@/lib/app-navigation-host";
import { useFixedPanelTabsState } from "@/lib/fixed-panel-tabs";
import type { SecondaryFileFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { canPopOutTab, type TabWindowRequest } from "@/lib/fork-tab-popout";
import { openTabSpecIn, specOwner } from "@/lib/fork-tab-move";
import { TabWindowContext } from "@/lib/fork-tab-window";
import { tabWindowPanelStateId } from "@/lib/fork-tab-window-panel";
import { usePluginSlots } from "@/lib/plugin-slots";
import { UrlOpenRoutingProvider } from "@/lib/url-open-routing";
import { createPanelActionDestination } from "@/components/plugin/PluginPanelActions";
import { PluginPanelTabContent } from "@/components/plugin/PluginPanelActions";
import { useThreadFixedTabs } from "@/components/plugin/PluginThreadFixedTabs";
import {
  LazyHostFilePreviewTabContent,
  LazyHostScopedFilePreviewTabContent,
  LazyThreadSecondaryPanel,
  LazyThreadStorageFilePreviewTabContent,
  LazyWorkspaceFilePreviewTabContent,
} from "@/components/secondary-panel/lazySecondaryPanelComponents";
import type { SecondaryPanelRenderableTab } from "@/components/secondary-panel/secondaryPanelTab";
import { usePanelFiles } from "@/components/secondary-panel/usePanelFiles";
import { usePanelTabPresenter } from "@/components/secondary-panel/usePanelTabPresenter";
import { useThreadFileTabs } from "@/components/secondary-panel/useThreadFileTabs";
import { useEnvironment } from "@/hooks/queries/environment-queries";
import { ForkItemDropHost } from "./ForkItemDropHost";
import { ForkWorkbenchSurface } from "./ForkWorkbenchSurface";

const THREAD_TAB_CONTEXT = { kind: "thread" } as const;
const NO_TERMINALS: ReadonlyMap<string, TerminalSession> = new Map();
const SEEDED_PREFIX = "bb-fork-tab-window-seeded:";
const SEED_RETRY_MS = 300;
const SEED_DEADLINE_MS = 30_000;
const noop = () => undefined;

function seededKey(windowId: string): string {
  return `${SEEDED_PREFIX}${windowId}`;
}

export function wasTabWindowSeeded(
  windowId: string,
  storage: Pick<Storage, "getItem"> | null,
): boolean {
  try {
    return storage?.getItem(seededKey(windowId)) === "1";
  } catch {
    return false;
  }
}

export function markTabWindowSeeded(
  windowId: string,
  storage: Pick<Storage, "setItem"> | null,
): void {
  try {
    storage?.setItem(seededKey(windowId), "1");
  } catch {
    return;
  }
}

function sessionStorageOrNull(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export async function seedTabWindow(
  request: Pick<TabWindowRequest, "spec" | "threadId">,
  isLive: () => boolean,
  now: () => number = Date.now,
): Promise<boolean> {
  const deadline = now() + SEED_DEADLINE_MS;
  while (isLive()) {
    const key = await openTabSpecIn(
      specOwner(request.spec),
      request.threadId,
      request.spec,
      undefined,
    );
    if (key !== null) return true;
    if (now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, SEED_RETRY_MS));
  }
  return false;
}

export interface TabWindowPanelState {
  activeTitle: string | null;
  tabCount: number;
  tabs: readonly SecondaryFileFixedPanelTab[];
}

export function ForkTabWindowPanel({
  request,
  environmentId,
  toolbar,
  onState,
  onEmpty,
}: {
  request: TabWindowRequest;
  environmentId: string | null;
  toolbar: HTMLElement | null;
  onState: (state: TabWindowPanelState) => void;
  onEmpty: () => void;
}) {
  const { threadId, windowId } = request;
  const panelStateId = tabWindowPanelStateId(threadId, windowId);
  const environment = useEnvironment(environmentId).data;
  const threadFixedTabs = useThreadFixedTabs({ threadId, environmentId });
  const threadPanelActions = usePluginSlots().threadPanelActions;
  const {
    activateTab,
    closeTab,
    openTab,
    openPluginPanel,
    orderedSecondaryFileTabs,
    reorderTab,
  } = useThreadFileTabs({
    panelStateId,
    syncThreadId: null,
    environmentId,
    fileOwnerThreadId: threadId,
    storageFiles: undefined,
    terminalSessions: undefined,
  });
  const state = useFixedPanelTabsState(panelStateId, null);
  const activeTab =
    state.secondary.tabs.find(
      (tab) => tab.id === state.secondary.activeTabId,
    ) ?? null;
  const destinations = useMemo(
    () =>
      threadFixedTabs.actions.map((action) =>
        createPanelActionDestination({ action, openPluginPanel }),
      ),
    [openPluginPanel, threadFixedTabs.actions],
  );
  const panel = useAppPanelController({
    activeTabId: activeTab?.id ?? null,
    close: noop,
    destinations,
    isFocused: true,
  });
  const panelFiles = usePanelFiles({
    available: true,
    openTab,
    reveal: noop,
    scope: {
      threadId,
      environmentId,
      hostId: environment?.hostId ?? null,
    },
  });
  const capabilities = useMemo(
    () => ({
      openFilePreview: panelFiles.openFilePreview,
      panel,
      openTerminal: () => false,
    }),
    [panel, panelFiles.openFilePreview],
  );
  const presentPanelTab = usePanelTabPresenter({
    tabs: orderedSecondaryFileTabs,
    terminalsById: NO_TERMINALS,
    pluginActions: threadPanelActions,
  });
  const tabEnvironment = useMemo(
    () => (environmentId === null ? null : { id: environmentId }),
    [environmentId],
  );
  const activeFileTab =
    activeTab === null
      ? null
      : (orderedSecondaryFileTabs.find((tab) => tab.id === activeTab.id) ??
        null);
  const activeTitle =
    activeFileTab === null ? null : presentPanelTab(activeFileTab).label;
  const renderTabContent = useCallback(
    (tab: SecondaryFileFixedPanelTab): ReactNode => {
      const isActive = tab.id === activeTab?.id;
      const tabWindow = {
        title: isActive ? (activeTitle ?? "") : "",
        toolbar: isActive ? toolbar : null,
      };
      const content = (() => {
        switch (tab.kind) {
          case "plugin-panel":
            return (
              <PluginPanelTabContent
                tab={tab}
                context={{
                  kind: "thread",
                  threadId,
                  environment: tabEnvironment,
                }}
              />
            );
          case "workspace-file-preview":
            return tab.environmentId === null ? null : (
              <LazyWorkspaceFilePreviewTabContent
                activePath={tab.path}
                environmentId={tab.environmentId}
                isPanelOpen
                lineRange={tab.lineRange}
                source={tab.source}
                threadId={threadId}
              />
            );
          case "host-file-preview":
            return tab.hostId !== null ? (
              <LazyHostScopedFilePreviewTabContent
                activePath={tab.path}
                hostId={tab.hostId}
                isPanelOpen
                lineRange={tab.lineRange}
              />
            ) : (
              <LazyHostFilePreviewTabContent
                activePath={tab.path}
                copyPath={tab.path}
                environmentId={tab.environmentId}
                isPanelOpen
                lineRange={tab.lineRange}
                threadId={threadId}
              />
            );
          case "thread-storage-file-preview":
            return (
              <LazyThreadStorageFilePreviewTabContent
                activePath={tab.path}
                isPanelOpen
                lineRange={tab.lineRange}
                threadId={tab.threadId ?? threadId}
              />
            );
          default:
            return null;
        }
      })();
      return (
        <TabWindowContext.Provider value={tabWindow}>
          {content}
        </TabWindowContext.Provider>
      );
    },
    [activeTab?.id, activeTitle, tabEnvironment, threadId, toolbar],
  );
  const panelTabs = useMemo<readonly SecondaryPanelRenderableTab[]>(
    () =>
      orderedSecondaryFileTabs
        .filter((tab) => canPopOutTab(tab))
        .map((tab) => ({
          ...presentPanelTab(tab),
          contentFillsRegion: true,
          tab,
          renderContent: () => renderTabContent(tab),
          onSelect: () => activateTab(tab.id),
          onClose: () => closeTab(tab.id),
        })),
    [
      activateTab,
      closeTab,
      orderedSecondaryFileTabs,
      presentPanelTab,
      renderTabContent,
    ],
  );

  const latestState = useRef<TabWindowPanelState | null>(null);
  useLayoutEffect(() => {
    const next: TabWindowPanelState = {
      activeTitle,
      tabCount: panelTabs.length,
      tabs: panelTabs.map((tab) => tab.tab),
    };
    const previous = latestState.current;
    if (
      previous !== null &&
      previous.activeTitle === next.activeTitle &&
      previous.tabCount === next.tabCount &&
      previous.tabs.every((tab, index) => tab === next.tabs[index])
    ) {
      return;
    }
    latestState.current = next;
    onState(next);
  });

  const seeded = useRef(false);
  const hadTabs = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    const storage = sessionStorageOrNull();
    if (wasTabWindowSeeded(windowId, storage)) {
      hadTabs.current = true;
      return;
    }
    let live = true;
    void seedTabWindow({ spec: request.spec, threadId }, () => live).then(
      (ok) => {
        if (!live) return;
        if (!ok) {
          seeded.current = false;
          return;
        }
        markTabWindowSeeded(windowId, storage);
        hadTabs.current = true;
      },
    );
    return () => {
      live = false;
      seeded.current = false;
    };
  }, [request.spec, threadId, windowId]);
  const storedTabCount = state.secondary.tabs.length;
  useEffect(() => {
    if (storedTabCount > 0) {
      hadTabs.current = true;
      return;
    }
    if (!hadTabs.current) return;
    const timer = setTimeout(onEmpty, 0);
    return () => clearTimeout(timer);
  }, [onEmpty, storedTabCount]);

  return (
    <UrlOpenRoutingProvider openInAppBrowser={null}>
      <AppNavigationHostProvider capabilities={capabilities}>
        <AppPanelTabsPublisher
          publish={panel.publishTabs}
          activeTabId={activeTab?.id ?? null}
          actionContext={THREAD_TAB_CONTEXT}
          fixedTabs={[]}
          isOpen
          tabs={panelTabs}
        />
        <ForkWorkbenchSurface threadId={threadId} panelStateId={panelStateId} />
        <ForkItemDropHost threadId={threadId} />
        {threadFixedTabs.observers}
        <PanelGroup direction="horizontal" className="min-h-0 flex-1">
          <LazyThreadSecondaryPanel
            activeTab={activeTab}
            areFixedTabsReady
            drawerFallback={null}
            environmentId={environmentId ?? undefined}
            fixedTabs={[]}
            inlinePanelToggle="hidden"
            isConversationCollapsed
            isOpen
            metadataContent={null}
            onClose={noop}
            onCollapse={noop}
            onOpenNewTab={noop}
            onPanelFocus={noop}
            onTabReorder={reorderTab}
            onToggleConversationCollapse={noop}
            renderAsDrawer={false}
            resizablePanelId={`fork-tab-window-${windowId}`}
            showConversationCollapseControl={false}
            showNewTabButton={false}
            splitPanelStateId={panelStateId}
            tabs={panelTabs}
          />
        </PanelGroup>
      </AppNavigationHostProvider>
    </UrlOpenRoutingProvider>
  );
}
