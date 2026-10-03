// The sidebar's tab list, below the address bar and Essentials: Pinned (tabs
// and folders you keep), then Today (everything else you opened, newest first,
// archived on its own after a while). The footer holds the Spaces, one mark
// each, like Arc's dots. See docs/office-tabs.md.
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Menu from "@radix-ui/react-dropdown-menu";
import {
  experimental_useSidebarNavigation as useSidebarNavigation,
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@bb-studio/kit/app";
import { useMemo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { openCommandBar } from "./CommandBar";
import { useTabDragState, zoneKey } from "./tabDrag";
import { useLocationHref } from "./location";
import { requestCount, setCurrentSpaceId, useInboxCounts, useSpaces } from "./model";
import { openOffice } from "./routes";
import { TAB, TabRow, openTab, type TabMoves } from "./TabRow";
import { isTabActive, useTabActions, useTabs, useTrackOpen, type ShownTab, type TabFolder, type TabZone } from "./tabs";
import { MENU, MENU_ITEM, MENU_SEPARATOR, PORTAL_SCOPE, cn } from "./styles";

/** BB's settings-like rows, reachable from the footer menu. */
const BB_ROWS = /plugins|skills|automations/i;

/** A section's label and rule; dropping a tab on it puts the tab first in that section. */
function Divider({ label, zone, action }: { label: string; zone: TabZone; action?: ReactNode }) {
  const drag = useTabDragState();
  const target = drag?.target;
  const here = !!target && !target.beside && target.zoneKey === zone;
  return (
    <div
      data-tab-drop-zone=""
      data-zone={zone}
      data-at="start"
      className={cn("group/divider flex h-7 items-center gap-2 rounded-md px-2.5 pt-2 text-xs font-medium text-subtle-foreground", here && "text-foreground")}
    >
      <span>{label}</span>
      <span aria-hidden className={cn("h-px flex-1 bg-border", here && "h-0.5 bg-ring")} />
      {action}
    </div>
  );
}

/** Follows the pointer while a tab is dragged inside the sidebar. */
function DragGhost() {
  const drag = useTabDragState();
  if (!drag || drag.outside) return null;
  return createPortal(
    <div {...PORTAL_SCOPE} className="pointer-events-none fixed z-50 max-w-56 truncate rounded-lg bg-popover px-2.5 py-1.5 text-sm text-popover-foreground shadow-lg ring-1 ring-border" style={{ left: drag.x + 12, top: drag.y + 8 }}>
      {drag.title}
    </div>,
    document.body,
  );
}

function FolderRow({ folder, onToggle, onRename, onDelete }: { folder: TabFolder; onToggle: () => void; onRename: () => void; onDelete: () => void }) {
  const drag = useTabDragState();
  const here = !!drag?.target && !drag.target.beside && drag.target.zoneKey === zoneKey("pinned", folder.id);
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={folder.open}
          data-tab-drop-zone=""
          data-zone="pinned"
          data-folder={folder.id}
          data-at="end"
          className={cn(TAB, here && "bg-sidebar-accent ring-1 ring-ring")}
        >
          <span aria-hidden className="inline-flex size-5 shrink-0 items-center justify-center text-subtle-foreground [&_svg]:size-4">
            <Icon name={folder.open ? "FolderOpen" : "Folder"} />
          </span>
          <span className="min-w-0 flex-1 truncate font-medium">{folder.name}</span>
          <Icon name={folder.open ? "ChevronDown" : "ChevronRight"} aria-hidden className="size-3.5 shrink-0 text-subtle-foreground" />
        </button>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content {...PORTAL_SCOPE} className={MENU}>
          <ContextMenu.Item onSelect={onRename} className={MENU_ITEM}><Icon name="Edit" aria-hidden />Rename</ContextMenu.Item>
          <ContextMenu.Separator className={MENU_SEPARATOR} />
          <ContextMenu.Item onSelect={onDelete} className={MENU_ITEM}><Icon name="FolderMinus" aria-hidden />Remove folder (keeps its tabs)</ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function SpacesFooter() {
  const { spaces, current } = useSpaces();
  const counts = useInboxCounts();
  const { items, actions } = useSidebarNavigation();
  const bbRows = items.filter((item) => item.pluginId === null && BB_ROWS.test(item.id) && !item.isDisabled);
  return (
    <div className="sticky bottom-0 mt-auto flex items-center gap-1 bg-sidebar px-1.5 pt-2 pb-1">
      <button type="button" aria-label="Archived tabs" title="Archived tabs" onClick={() => openCommandBar("archived")} className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-subtle-foreground hover:bg-sidebar-accent hover:text-foreground [&_svg]:size-4">
        <Icon name="Archive" />
      </button>
      <div role="tablist" aria-label="Spaces" className="flex min-w-0 flex-1 items-center justify-center gap-1.5 overflow-x-auto">
        {spaces.map((space) => {
          const isCurrent = space.id === current?.id;
          const waiting = requestCount(counts.data, space.id);
          return (
            <button
              key={space.id}
              type="button"
              role="tab"
              aria-selected={isCurrent}
              aria-label={`${space.name}${waiting ? `, ${waiting} waiting` : ""}`}
              title={space.name}
              onClick={() => setCurrentSpaceId(space.id)}
              // Arc's Space dots: its emoji, or a dot in its color; the one
              // you're in sits on a soft circle of that color.
              style={isCurrent ? { backgroundColor: `color-mix(in oklab, ${space.color} 32%, transparent)` } : undefined}
              className={cn(
                "relative inline-flex size-7 shrink-0 items-center justify-center rounded-full outline-none transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                !isCurrent && "hover:bg-sidebar-accent",
              )}
            >
              {space.icon
                ? <span aria-hidden className={cn("text-[15px] leading-none", !isCurrent && "opacity-55 grayscale-[35%]")}>{space.icon}</span>
                : <span aria-hidden className={cn("rounded-full", isCurrent ? "size-2.5" : "size-2 opacity-55")} style={{ backgroundColor: space.color }} />}
              {waiting && !isCurrent ? <span aria-hidden className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-warning-foreground" /> : null}
            </button>
          );
        })}
      </div>
      <Menu.Root>
        <Menu.Trigger aria-label="Space menu" className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-subtle-foreground outline-none hover:bg-sidebar-accent hover:text-foreground data-[state=open]:bg-sidebar-accent [&_svg]:size-4">
          <Icon name="MoreHorizontal" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content {...PORTAL_SCOPE} side="top" align="end" className={MENU}>
            <Menu.Item onSelect={() => openOffice("settings")} className={MENU_ITEM}><Icon name="SlidersHorizontal" aria-hidden />{current ? `${current.name} settings` : "Space settings"}</Menu.Item>
            <Menu.Item onSelect={() => openOffice("team/new")} className={MENU_ITEM}><Icon name="UserPlus" aria-hidden />Add a bot</Menu.Item>
            <Menu.Item onSelect={() => openOffice("spaces/new")} className={MENU_ITEM}><Icon name="Plus" aria-hidden />New space</Menu.Item>
            {bbRows.length ? <Menu.Separator className={MENU_SEPARATOR} /> : null}
            {bbRows.map((item) => (
              <Menu.Item key={item.id} onSelect={() => actions.activate(item.id, { openInSplit: false })} className={MENU_ITEM}>
                <Icon name="SlidersHorizontal" aria-hidden />{item.label}
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}

export function OfficeTabs({ activeThreadId, onNavigate }: PluginThreadListProps) {
  const { current } = useSpaces();
  const spaceId = current?.id ?? null;
  const locationHref = useLocationHref();
  const tabs = useTabs(spaceId);
  const actions = useTabActions(spaceId, tabs.refresh);
  const threadActions = useSidebarThreadActions();

  const all = useMemo(() => [...tabs.essentials, ...tabs.pinned, ...tabs.today], [tabs.essentials, tabs.pinned, tabs.today]);
  const knownRefs = useMemo(() => new Set(all.map((tab) => tab.ref)), [all]);
  const knownHrefs = useMemo(() => new Set(all.flatMap((tab) => (tab.href ? [tab.href] : []))), [all]);
  useTrackOpen(spaceId, activeThreadId, knownHrefs, knownRefs, tabs.refresh);

  const moves: TabMoves = actions;
  const open = (tab: ShownTab, options: { split: boolean }) => { openTab(tab, threadActions, options); onNavigate(); };
  const row = (tab: ShownTab, indent = false) => (
    <TabRow key={tab.ref} tab={tab} indent={indent} active={isTabActive(tab, activeThreadId, locationHref)} folders={tabs.folders} moves={moves} onOpen={open} />
  );

  const loose = tabs.pinned.filter((tab) => !tab.folderId);
  const folders = [...tabs.folders].sort((a, b) => a.position - b.position);
  // While a tab is dragged, Pinned shows even when empty, so there's somewhere to pin it.
  const dragging = useTabDragState() !== null;

  return (
    <div className="flex min-h-full flex-col px-2">
      {loose.length || folders.length || dragging ? <Divider label="Pinned" zone="pinned" /> : null}
      <div className="space-y-px">
        {/* Loose tabs first, so dropping on "Pinned" lands right under it. */}
        {loose.map((tab) => row(tab))}
        {folders.map((folder) => (
          <div key={folder.id} className="space-y-px">
            <FolderRow
              folder={folder}
              onToggle={() => actions.updateFolder(folder.id, { open: !folder.open })}
              onRename={() => { const name = prompt("Folder name", folder.name)?.trim(); if (name && name !== folder.name) actions.updateFolder(folder.id, { name }); }}
              onDelete={() => actions.deleteFolder(folder.id)}
            />
            {folder.open ? tabs.pinned.filter((tab) => tab.folderId === folder.id).map((tab) => row(tab, true)) : null}
          </div>
        ))}
      </div>

      <Divider
        label="Today"
        zone="today"
        action={tabs.today.length
          ? <button type="button" onClick={() => { for (const tab of tabs.today) actions.archive(tab.ref); }} className="rounded px-1 text-xs text-subtle-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover/divider:opacity-100">Clear</button>
          : null}
      />
      <div className="space-y-px">
        {tabs.today.map((tab) => row(tab))}
        <button type="button" onClick={() => openCommandBar()} data-tab-drop-zone="" data-zone="today" data-at="end" className={cn(TAB, "text-muted-foreground")}>
          <span aria-hidden className="inline-flex size-5 shrink-0 items-center justify-center [&_svg]:size-4"><Icon name="Plus" /></span>
          <span className="min-w-0 flex-1 truncate">New tab</span>
        </button>
      </div>

      <SpacesFooter />
      <DragGhost />
    </div>
  );
}
