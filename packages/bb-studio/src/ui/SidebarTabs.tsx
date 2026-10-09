// The Studio section of the sidebar: a tab for each Studio item the user has
// opened, from any add-on. Opening an item's view adds its tab; × closes it,
// and closing the one on screen opens the next. A tab's ⋯ or right-click
// opens it in a split.
import {
  DropdownMenuItem,
  Icon,
  SidebarDisplayMenuItems,
  SidebarGroupHeading,
  SidebarNote,
  SidebarPortal,
  SidebarSection,
  openAppPath,
  studioPath,
  useSidebarDisplay,
  useSidebarHosted,
  useSidebarNavigated,
  usePathname,
  WORKSPACE_PATH,
} from "@bb-studio/kit/app";
import { STUDIO_REALTIME_CHANNEL } from "@bb-studio/kit/contract";
import { errorMessage } from "@bb-studio/kit/format";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useState } from "react";
import type { rpcContract, TabView } from "../contract";
import { TABS_CHANNEL } from "../ids";
import { itemAtPath } from "../tabs";
import { closeWorkspaceTabs, useWorkspace } from "./Workspace";
import { panes } from "./workspace-state";
import { SidebarItemRow } from "./SidebarItemRow";
import { SidebarCreateMenu } from "./SidebarCreateMenu";
import { useBySpace } from "./space/SidebarSpacesSection";

const REFETCH_DEBOUNCE_MS = 300;
const APP_NAMES: Record<string, string> = {
  pages: "Pages",
  talk: "Talk",
  excalidraw: "Drawings",
  artifacts: "Artifacts",
};

function useTabs(enabled: boolean) {
  const rpc = useRpc<typeof rpcContract>();
  const [tabs, setTabs] = useState<TabView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refetch = useCallback(() => {
    rpc.call("tabs", null).then(
      (result) => {
        setTabs(result.tabs);
        setError(null);
      },
      (cause: unknown) => setError(errorMessage(cause)),
    );
  }, [rpc]);
  useEffect(() => {
    if (enabled) refetch();
  }, [enabled, refetch]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const soon = () => {
    if (!enabled) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(refetch, REFETCH_DEBOUNCE_MS);
  };
  useRealtime(TABS_CHANNEL, soon);
  // Titles change and items go away.
  useRealtime(STUDIO_REALTIME_CHANNEL, soon);
  return { tabs, setTabs, error, refetch, rpc };
}

export function SidebarTabs() {
  const hosted = useSidebarHosted();
  const path = usePathname();
  const workspace = useWorkspace();
  const workspacePath = path.replace(/\/+$/, "") === WORKSPACE_PATH ? panes(workspace.layout).find(pane => pane.id === workspace.focused)?.active : null;
  const { tabs, setTabs, error, refetch, rpc } = useTabs(hosted);
  const navigated = useSidebarNavigated();
  const bySpace = useBySpace();
  const [display, setDisplay] = useSidebarDisplay(
    "studio:sidebar-tabs-display",
    { organization: "none", sort: "opened", direction: "ascending" },
    { organization: ["none", "app"], sort: ["opened", "alpha"] },
  );

  // Visiting an item's view opens its tab.
  const visited = useRef<string | null>(null);
  useEffect(() => {
    if (!hosted || visited.current === path) return;
    visited.current = path;
    if (!path.startsWith("/plugins/") || (tabs && itemAtPath(tabs, path))) return;
    rpc.call("visitTab", { path }).then(
      ({ tab }) => {
        if (tab) setTabs((current) => (current && !current.some((each) => each.pluginId === tab.pluginId && each.id === tab.id) ? [...current, tab] : current));
      },
      // Try again the next time this effect runs, e.g. when the tabs refresh.
      () => {
        if (visited.current === path) visited.current = null;
      },
    );
  }, [hosted, path, tabs, rpc, setTabs]);

  const active = tabs ? itemAtPath(tabs, workspacePath ?? path) : null;
  const open = (tab: TabView) => {
    openAppPath(tab.href);
    navigated();
  };
  const close = (closing: readonly TabView[]) => {
    if (!tabs || !closing.length) return;
    closeWorkspaceTabs(closing.map(tab => tab.href));
    const gone = new Set(closing.map((tab) => `${tab.pluginId}:${tab.id}`));
    const left = tabs.filter((tab) => !gone.has(`${tab.pluginId}:${tab.id}`));
    if (!workspacePath && active && gone.has(`${active.pluginId}:${active.id}`)) {
      // The next tab, or the one before when it was last.
      const index = tabs.indexOf(active);
      const next = tabs.slice(index + 1).find((tab) => !gone.has(`${tab.pluginId}:${tab.id}`)) ?? [...tabs.slice(0, index)].reverse().find((tab) => !gone.has(`${tab.pluginId}:${tab.id}`));
      openAppPath(next?.href ?? studioPath());
    }
    setTabs(left);
    rpc.call("closeTabs", { items: closing.map((tab) => ({ pluginId: tab.pluginId, id: tab.id })) }).then(undefined, refetch);
  };

  const sorted = [...(tabs ?? [])];
  if (display.sort === "alpha") sorted.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  if (display.direction === "descending") sorted.reverse();
  const groups =
    display.organization === "app"
      ? [...new Set(sorted.map((tab) => tab.pluginId))].map((pluginId) => ({ label: APP_NAMES[pluginId] ?? pluginId, tabs: sorted.filter((tab) => tab.pluginId === pluginId) }))
      : [{ label: null, tabs: sorted }];

  // Nothing open, nothing to show: the section only appears once an item is open.
  // By Space, each Space lists its own open items, so this section steps aside
  // while it keeps recording visits.
  if (bySpace || (tabs && !tabs.length && !error)) return null;
  return (
    <SidebarPortal id="tabs" title="Studio" order={0}>
      <SidebarSection
        title="Studio"
        actions={[{ label: "Open Studio", icon: "studio/studio", onClick: () => (openAppPath(studioPath("workspace")), navigated()) }]}
        trailing={<SidebarCreateMenu onNavigate={navigated} />}
        menu={
          <>
            <SidebarDisplayMenuItems
              noun="tabs"
              display={display}
              onChange={setDisplay}
              organize={[
                ["none", "No grouping"],
                ["app", "By app"],
              ]}
              sort={[
                ["opened", "Opened", "ascending"],
                ["alpha", "Alphabetical", "ascending"],
              ]}
            />
            {active && tabs && tabs.length > 1 ? (
              <DropdownMenuItem onSelect={() => close(tabs.filter((tab) => tab !== active))}>
                <Icon name="X" />
                Close other tabs
              </DropdownMenuItem>
            ) : null}
            {tabs?.length ? (
              <DropdownMenuItem onSelect={() => close(tabs)}>
                <Icon name="X" />
                Close all tabs
              </DropdownMenuItem>
            ) : null}
          </>
        }
      >
        {error && !tabs ? <SidebarNote tone="danger">{error}</SidebarNote> : null}
        {groups.filter((group) => group.tabs.length).map((group) => (
          <div key={group.label ?? "all"} className="flex flex-col gap-px">
            {group.label ? <SidebarGroupHeading>{group.label}</SidebarGroupHeading> : null}
            {group.tabs.map((tab) => (
              <TabRow
                key={`${tab.pluginId}:${tab.id}`}
                tab={tab}
                selected={tab === active}
                onOpen={() => open(tab)}
                onClose={() => close([tab])}
              />
            ))}
          </div>
        ))}
      </SidebarSection>
    </SidebarPortal>
  );
}

function TabRow({ tab, selected, onOpen, onClose }: { tab: TabView; selected: boolean; onOpen(): void; onClose(): void }) {
  return (
    <SidebarItemRow
      id={tab.id}
      href={tab.href}
      title={tab.title}
      kindIcon={tab.kindIcon}
      glyph={tab.icon}
      selected={selected}
      onOpen={onOpen}
      onClose={onClose}
      rowProps={{ "data-studio-tab": `${tab.pluginId}:${tab.id}` }}
    />
  );
}
