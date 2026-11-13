import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type DragEvent as ReactDragEvent,
  type ReactNode,
} from "react";
import { MouseSensor, useDndMonitor } from "@dnd-kit/core";
import { isSecondaryFileTab } from "@bb/client-core";
import type { FixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { useAtomValue } from "jotai";
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from "@bb/shared-ui/context-menu";
import { useAppCommandHandler } from "@/components/commands/AppCommandProvider";
import {
  globalPanelTabAppliesTo,
  globalPanelTabsAtom,
  threadIdOfPanelState,
} from "@/lib/fork-global-panel-tabs";
import { canPopOutTab, popOutWorkbenchTab } from "@/lib/fork-tab-popout";
import { findSurface } from "@/lib/fork-workbench";
import {
  beginPointerItemDrag,
  PANEL_TAB_STRIP_SELECTOR,
  panelTabDragItem,
  sidePanelOf,
  type PointerItemDrag,
} from "@/lib/fork-item-drag";
import { beginPanelTabDrag, endPanelTabDrag } from "@/lib/fork-tab-move";
import { usePluginSlots } from "@/lib/plugin-slots";
import type { SecondaryPanelRenderableTab } from "./secondaryPanelTab";
import { workbenchSplitsFor } from "./workbenchSplits.fork";

export { forkPageWorkbenchSurface } from "@/components/fork/ForkWorkbenchSurface";

export const WORKBENCH_NEW_TAB_IN_EVERY_PANE = true;

export class InertMouseSensor extends MouseSensor {
  static override activators = [] as typeof MouseSensor.activators;
}

export interface PanelTabNativeDragProps {
  draggable: true;
  onDragStart(event: ReactDragEvent<HTMLElement>): void;
  onDragEnd(event: ReactDragEvent<HTMLElement>): void;
}

export function usePanelTabNativeDrag(
  tab: SecondaryPanelRenderableTab,
): PanelTabNativeDragProps | null {
  const panelStateId = useContext(WorkbenchPanelContext);
  if (tab.isPinned === true || isFixedPanelTab(tab)) return null;
  return {
    draggable: true,
    onDragStart(event) {
      const item = panelTabDragItem(tab, panelStateId);
      if (item === null || event.dataTransfer === null) return;
      beginPanelTabDrag(event.dataTransfer, item, {
        panelStateId: panelStateId ?? "",
        key: tab.tab.id,
        panel: sidePanelOf(event.currentTarget),
        close: tab.onClose,
      });
    },
    onDragEnd(event) {
      endPanelTabDrag(event.dataTransfer?.dropEffect);
    },
  };
}

const WorkbenchPanelContext = createContext<string | null>(null);

export function WorkbenchPanelScope({
  panelStateId,
  children,
}: {
  panelStateId: string | undefined;
  children: ReactNode;
}) {
  return (
    <WorkbenchPanelContext.Provider value={panelStateId ?? null}>
      {children}
    </WorkbenchPanelContext.Provider>
  );
}

export function isFixedPanelTab(tab: SecondaryPanelRenderableTab): boolean {
  return tab.isPinned === true && tab.tab.kind === "plugin-panel";
}

export function fixedPanelTabsFirst(
  tabs: readonly SecondaryPanelRenderableTab[],
): readonly SecondaryPanelRenderableTab[] {
  const firstOwn = tabs.findIndex((tab) => !isFixedPanelTab(tab));
  if (firstOwn === -1 || !tabs.slice(firstOwn).some(isFixedPanelTab)) {
    return tabs;
  }
  return [
    ...tabs.filter(isFixedPanelTab),
    ...tabs.filter((tab) => !isFixedPanelTab(tab)),
  ];
}

export function usePinnedFixedPanelTabs(
  tabs: readonly SecondaryPanelRenderableTab[],
  panelStateId: string | undefined,
): readonly SecondaryPanelRenderableTab[] {
  const globalTabs = useAtomValue(globalPanelTabsAtom);
  const slots = usePluginSlots();
  return useMemo(() => {
    if (panelStateId === undefined || globalTabs.length === 0) return tabs;
    const applies = globalPanelTabAppliesTo(panelStateId, slots);
    const fixedIds = new Set(globalTabs.filter(applies).map((tab) => tab.id));
    if (!tabs.some((tab) => fixedIds.has(tab.tab.id))) return tabs;
    return tabs.map((tab) =>
      fixedIds.has(tab.tab.id) ? { ...tab, isPinned: true } : tab,
    );
  }, [globalTabs, panelStateId, slots, tabs]);
}

export function useFixedPanelTabDisplay(tab: SecondaryPanelRenderableTab): {
  isFixed: boolean;
} {
  return { isFixed: isFixedPanelTab(tab) };
}

function TabGroupDivider({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="mx-1 h-4 w-px shrink-0 self-center bg-border"
      data-panel-tabs-divider={name}
    />
  );
}

export function FixedPanelTabGroupEnd({
  tab,
  nextTab,
}: {
  tab: SecondaryPanelRenderableTab;
  nextTab: SecondaryPanelRenderableTab | undefined;
}) {
  if (!isFixedPanelTab(tab) || nextTab === undefined) return null;
  if (isFixedPanelTab(nextTab)) return null;
  return <TabGroupDivider name="fixed" />;
}

export function PinnedIconTabsDivider({
  tabs,
}: {
  tabs: readonly SecondaryPanelRenderableTab[];
}) {
  if (tabs.length === 0 || tabs.some(isFixedPanelTab)) return null;
  return <TabGroupDivider name="pinned" />;
}

export function PanelTabActionMenuItems({
  tab,
}: {
  tab: SecondaryPanelRenderableTab;
}) {
  const panelStateId = useContext(WorkbenchPanelContext);
  const paneMove = paneMoveFor(panelStateId, tab.tab.id);
  const popOutThreadId = popOutThreadFor(panelStateId, tab);
  return (
    <>
      {paneMove === null ? null : (
        <ContextMenuItem
          data-workbench-pane-move=""
          disabled={paneMove.disabled}
          onSelect={paneMove.run}
        >
          {paneMove.label}
        </ContextMenuItem>
      )}
      {popOutThreadId === null ? null : (
        <ContextMenuItem
          data-workbench-pop-out=""
          onSelect={() => {
            const surface = findSurface(popOutThreadId);
            if (surface !== null) void popOutWorkbenchTab(surface, tab.tab.id);
          }}
        >
          Open in new window
        </ContextMenuItem>
      )}
      {paneMove === null && popOutThreadId === null ? null : (
        <ContextMenuSeparator />
      )}
    </>
  );
}

function paneMoveFor(
  panelStateId: string | null,
  tabId: string,
): { label: string; disabled: boolean; run: () => void } | null {
  const splits =
    panelStateId === null ? null : workbenchSplitsFor(panelStateId);
  if (splits === null) return null;
  const panes = splits.panes();
  const pane = panes.find((candidate) => candidate.tabIds.includes(tabId));
  if (pane === undefined) return null;
  const single = panes.length === 1;
  return {
    label: single ? "Move to new pane" : "Move to other pane",
    disabled: single && pane.tabIds.length < 2,
    run: () =>
      single ? splits.moveToNewPane(tabId) : splits.moveToOtherPane(tabId),
  };
}

function popOutThreadFor(
  panelStateId: string | null,
  tab: SecondaryPanelRenderableTab,
): string | null {
  if (panelStateId === null || tab.isPinned === true) return null;
  const threadId = threadIdOfPanelState(panelStateId);
  return threadId !== null && canPopOutTab(tab.tab) ? threadId : null;
}

function dragPoint(
  activator: Event,
  delta: { x: number; y: number },
): { x: number; y: number } | null {
  const start =
    activator instanceof MouseEvent
      ? activator
      : typeof TouchEvent === "function" && activator instanceof TouchEvent
        ? activator.touches[0]
        : undefined;
  if (start === undefined) return null;
  return { x: start.clientX + delta.x, y: start.clientY + delta.y };
}

export function PanelTabItemDragSource({
  tabs,
}: {
  tabs: readonly SecondaryPanelRenderableTab[];
}) {
  const panelStateId = useContext(WorkbenchPanelContext);
  const drag = useRef<PointerItemDrag | null>(null);
  useEffect(
    () => () => {
      drag.current?.cancel();
      drag.current = null;
    },
    [],
  );
  useDndMonitor({
    onDragStart(event) {
      const tab = tabs.find(
        (candidate) => candidate.tab.id === event.active.id,
      );
      const item =
        tab === undefined ? null : panelTabDragItem(tab, panelStateId);
      if (item === null || event.activatorEvent === null) return;
      const origin = event.activatorEvent.target;
      drag.current = beginPointerItemDrag(
        document,
        item,
        origin instanceof Element
          ? origin.closest(PANEL_TAB_STRIP_SELECTOR)
          : null,
      );
    },
    onDragMove(event) {
      const point = dragPoint(event.activatorEvent, event.delta);
      if (point !== null) drag.current?.move(point.x, point.y);
    },
    onDragEnd(event) {
      const point = dragPoint(event.activatorEvent, event.delta);
      if (point === null) drag.current?.cancel();
      else drag.current?.end(point.x, point.y);
      drag.current = null;
    },
    onDragCancel() {
      drag.current?.cancel();
      drag.current = null;
    },
  });
  return null;
}

export function useForkCloseFileTabCommand(
  enabled: boolean,
  activeTab: FixedPanelTab | null,
  closeTab: (tabId: string) => void,
): void {
  useAppCommandHandler("panel.close", () => {
    if (!enabled || activeTab === null || !isSecondaryFileTab(activeTab)) {
      return false;
    }
    closeTab(activeTab.id);
    return true;
  });
}
