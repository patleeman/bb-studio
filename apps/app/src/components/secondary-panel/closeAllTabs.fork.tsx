import {
  ContextMenuItem,
  ContextMenuShortcut,
} from "@bb/shared-ui/context-menu";
import {
  useAppCommandHandler,
  useAppCommandShortcut,
} from "@/components/commands/AppCommandProvider";
import { useOptionalPaneContext } from "@/views/thread-detail/PaneContext";
import type { SecondaryPanelRenderableTab } from "./secondaryPanelTab";
import { useWorkbenchPaneFocused } from "./workbenchFork";

type CloseTabs = (tabId: string, scope: "all") => void;

export function closableTabs(
  tabs: readonly SecondaryPanelRenderableTab[],
): SecondaryPanelRenderableTab[] {
  return tabs.filter((tab) => tab.isPinned !== true);
}

export function ForkCloseAllTabsMenuItem({
  tabs,
  onCloseAll,
}: {
  tabs: readonly SecondaryPanelRenderableTab[];
  onCloseAll: () => void;
}) {
  const shortcut = useAppCommandShortcut("panel.closeAll");
  return (
    <ContextMenuItem
      disabled={closableTabs(tabs).length === 0}
      onSelect={onCloseAll}
    >
      Close all tabs
      {shortcut === null ? null : (
        <ContextMenuShortcut aria-hidden>{shortcut.label}</ContextMenuShortcut>
      )}
    </ContextMenuItem>
  );
}

export function useForkCloseAllTabsCommand(
  isPanelOpen: boolean,
  tabs: readonly SecondaryPanelRenderableTab[],
  closeTabs: CloseTabs,
): void {
  const threadPane = useOptionalPaneContext();
  const panelPaneFocused = useWorkbenchPaneFocused();
  useAppCommandHandler("panel.closeAll", () => {
    if (!isPanelOpen || !panelPaneFocused) return false;
    if (threadPane !== null && !threadPane.isFocused) return false;
    const first = tabs[0];
    if (first === undefined || closableTabs(tabs).length === 0) return false;
    closeTabs(first.tab.id, "all");
    return true;
  });
}
