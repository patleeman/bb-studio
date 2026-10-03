// The sidebar's tab list, below the address bar and Essentials: Pinned (tabs
// and folders you keep), then Today (everything else you opened, newest first,
// archived on its own after a while). The footer holds the Spaces, one mark
// each, like Arc's dots. See docs/office-tabs.md.
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Menu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import {
  experimental_useSidebarNavigation as useSidebarNavigation,
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  useSidebarSplitLayout,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@bb-studio/kit/app";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { openCommandBar } from "./CommandBar";
import { folderTargetAt, useTabDrag, useTabDragState, zoneKey, type DropTarget } from "./tabDrag";
import { useLocationHref } from "./location";
import { requestCount, setCurrentSpaceId, useCall, useInboxCounts, useSpaces, type Space } from "./model";
import { SPACE_COLORS } from "../../office/space-colors";
import { openOffice } from "./routes";
import { DropLine, TAB, TabRow, openTab, type TabMoves } from "./TabRow";
import { isTabActive, readRouting, shownTab, threadRef, useTabActions, writeRouting, type Routing, useTabs, useTrackOpen, type ShownTab, type TabFolder, type TabZone } from "./tabs";
import { MENU, MENU_ITEM, MENU_SEPARATOR, PORTAL_SCOPE, cn } from "./styles";

/** BB's settings-like rows, reachable from the footer menu. */
const BB_ROWS = /plugins|skills|automations/i;

/** A section's label and rule; dropping a tab on it puts the tab first in that section. */
/**
 * Section edges, as in Arc: the Space's name heads the pinned tabs, and an
 * unlabelled rule (with Clear) sets them off from today's. Dropping a tab on
 * either puts it first in that section.
 */
function SectionEdge({ label, zone, action }: { label?: string; zone: TabZone; action?: ReactNode }) {
  const drag = useTabDragState();
  const target = drag?.target;
  const here = !!target && !target.beside && target.zoneKey === zone;
  return (
    <div
      data-tab-drop-zone=""
      data-zone={zone}
      data-at="start"
      className={cn("group/divider flex h-7 items-center gap-2 rounded-md px-2.5 text-xs font-medium text-foreground/45", label ? "pt-1" : "pt-2", here && "text-foreground")}
    >
      {label ? <span className="min-w-0 flex-1 truncate">{label}</span> : <span aria-hidden className={cn("h-px flex-1 bg-foreground/[0.12]", here && "h-0.5 bg-ring")} />}
      {label && here ? <span aria-hidden className="h-0.5 w-8 rounded-full bg-ring" /> : null}
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

/** Names a folder in place, like renaming a tab: Enter saves, Escape or an empty name cancels. */
function FolderNameField({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  // Focus after the opening menu has finished closing, and only treat a blur
  // as "done" once the field has had focus.
  const focused = useRef(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => { input.current?.focus(); input.current?.select(); });
    return () => cancelAnimationFrame(frame);
  }, []);
  const finish = (save: boolean) => onDone(save && value.trim() ? value.trim() : null);
  return (
    <div className={cn(TAB, "bg-foreground/[0.08]")}>
      <span aria-hidden className="inline-flex size-5 shrink-0 items-center justify-center text-foreground/45 [&_svg]:size-4"><Icon name="Folder" /></span>
      <input
        ref={input}
        aria-label="Folder name"
        placeholder="Folder name"
        value={value}
        maxLength={100}
        onChange={(change) => setValue(change.target.value)}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { if (focused.current) finish(true); }}
        onKeyDown={(key) => {
          if (key.key === "Enter") finish(true);
          if (key.key === "Escape") finish(false);
        }}
        className="h-6 min-w-0 flex-1 rounded-sm bg-foreground/[0.06] px-1 text-sm font-medium outline-none ring-1 ring-ring"
      />
    </div>
  );
}

/**
 * A Pinned folder, as in Arc: click to open or close, drop tabs on it to file
 * them, drag it to reorder, right-click to rename or remove.
 */
function FolderRow({ folder, renaming, onToggle, onRename, onStartRename, onDelete, onMove }: {
  folder: TabFolder;
  renaming: boolean;
  onToggle: () => void;
  onRename: (name: string | null) => void;
  onStartRename: () => void;
  onDelete: () => void;
  onMove: (index: number) => void;
}) {
  const drag = useTabDragState();
  const ref = `folder:${folder.id}`;
  const here = !!drag?.target && !drag.target.beside && drag.target.zoneKey === zoneKey("pinned", folder.id);
  const beside = drag?.target?.beside?.ref === ref ? drag.target.beside : null;
  const drop = useCallback((target: DropTarget) => onMove(target.index), [onMove]);
  const startDrag = useTabDrag({ ref, title: folder.name }, drop, undefined, folderTargetAt);
  if (renaming) return <FolderNameField initial={folder.name} onDone={onRename} />;
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div className={cn("relative", drag?.ref === ref && "opacity-40")} data-tab-folder-row="" data-folder={folder.id}>
          {beside ? <DropLine after={beside.after} /> : null}
          <button
            type="button"
            onPointerDown={startDrag}
            onClick={onToggle}
            onDoubleClick={onStartRename}
            aria-expanded={folder.open}
            data-tab-drop-zone=""
            data-zone="pinned"
            data-folder={folder.id}
            data-at="end"
            className={cn(TAB, here && "bg-foreground/[0.08] ring-1 ring-ring")}
          >
            <span aria-hidden className="inline-flex size-5 shrink-0 items-center justify-center text-foreground/45 [&_svg]:size-4">
              <Icon name={folder.open ? "FolderOpen" : "Folder"} />
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">{folder.name}</span>
            <Icon name={folder.open ? "ChevronDown" : "ChevronRight"} aria-hidden className="size-3.5 shrink-0 text-foreground/45" />
          </button>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content {...PORTAL_SCOPE} className={MENU} onCloseAutoFocus={(event) => event.preventDefault()}>
          <ContextMenu.Item onSelect={onStartRename} className={MENU_ITEM}><Icon name="Edit" aria-hidden />Rename</ContextMenu.Item>
          <ContextMenu.Separator className={MENU_SEPARATOR} />
          <ContextMenu.Item onSelect={onDelete} className={MENU_ITEM}><Icon name="FolderMinus" aria-hidden />Remove folder (keeps its tabs)</ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/**
 * One Space in the footer, as in Arc: its emoji, or a dot in its color, and
 * the current one on a soft circle of that color. Right-click to rename it,
 * change its icon or color, make or delete a Space; drag to reorder.
 */
function SpaceMarkButton({ space, isCurrent, waiting, order, onChanged }: { space: Space; isCurrent: boolean; waiting: number; order: readonly string[]; onChanged: () => void }) {
  const call = useCall();
  const [editing, setEditing] = useState<"name" | "icon" | null>(null);
  const update = (patch: { name?: string; icon?: string | null; color?: string }) => void call("space_update", { spaceId: space.id, ...patch }).then(onChanged, onChanged);
  const drop = useCallback((target: DropTarget) => {
    const rest = order.filter((id) => id !== space.id);
    rest.splice(target.index, 0, space.id);
    void call("space_reorder", { spaceIds: rest }).then(onChanged, onChanged);
  }, [call, order, space.id, onChanged]);
  const startDrag = useTabDrag({ ref: `space:${space.id}`, title: space.name }, drop, undefined, spaceTargetAt);
  const drag = useTabDragState();
  const beside = drag?.target?.beside?.ref === `space:${space.id}` ? drag.target.beside : null;
  const remove = () => {
    if (space.isDefault) return;
    if (confirm(`Delete the Space “${space.name}”? Its folders move to your default Space.`)) void call("space_delete", { spaceId: space.id }).then(onChanged, onChanged);
  };
  return (
    <Popover.Root open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <Popover.Anchor asChild>
            <button
              type="button"
              role="tab"
              aria-selected={isCurrent}
              aria-label={`${space.name}${waiting ? `, ${waiting} waiting` : ""}`}
              title={space.name}
              data-space-mark={space.id}
              onPointerDown={startDrag}
              onClick={() => setCurrentSpaceId(space.id)}
              style={isCurrent ? { backgroundColor: `color-mix(in oklab, ${space.color} 32%, transparent)` } : undefined}
              className={cn(
                "relative inline-flex size-7 shrink-0 items-center justify-center rounded-full outline-none transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                !isCurrent && "hover:bg-foreground/[0.07]",
                drag?.ref === `space:${space.id}` && "opacity-40",
              )}
            >
              {beside ? <DropLine after={beside.after} axis="x" /> : null}
              {space.icon
                ? <span aria-hidden className={cn("text-[15px] leading-none", !isCurrent && "opacity-55 grayscale-[35%]")}>{space.icon}</span>
                : <span aria-hidden className={cn("rounded-full", isCurrent ? "size-2.5" : "size-2 opacity-55")} style={{ backgroundColor: space.color }} />}
              {waiting && !isCurrent ? <span aria-hidden className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-warning-foreground" /> : null}
            </button>
          </Popover.Anchor>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content {...PORTAL_SCOPE} className={MENU} onCloseAutoFocus={(event) => event.preventDefault()}>
            <ContextMenu.Item onSelect={() => setEditing("name")} className={MENU_ITEM}><Icon name="Edit" aria-hidden />Change name…</ContextMenu.Item>
            <ContextMenu.Item onSelect={() => setEditing("icon")} className={MENU_ITEM}><Icon name="Square" aria-hidden />Change icon…</ContextMenu.Item>
            <ContextMenu.Sub>
              <ContextMenu.SubTrigger className={MENU_ITEM}><Icon name="Palette" aria-hidden />Color<Icon name="ChevronRight" aria-hidden className="ml-auto" /></ContextMenu.SubTrigger>
              <ContextMenu.Portal>
                <ContextMenu.SubContent {...PORTAL_SCOPE} className={cn(MENU, "grid grid-cols-3 gap-1 p-1.5")}>
                  {SPACE_COLORS.map((color) => (
                    <ContextMenu.Item
                      key={color}
                      aria-label={color}
                      onSelect={() => update({ color })}
                      className="flex size-7 items-center justify-center rounded-md outline-none data-[highlighted]:bg-state-hover"
                    >
                      <span className={cn("size-4 rounded-full", space.color === color && "ring-2 ring-foreground ring-offset-1 ring-offset-popover")} style={{ backgroundColor: color }} />
                    </ContextMenu.Item>
                  ))}
                </ContextMenu.SubContent>
              </ContextMenu.Portal>
            </ContextMenu.Sub>
            <ContextMenu.Separator className={MENU_SEPARATOR} />
            <ContextMenu.Item onSelect={() => openOffice("spaces/new")} className={MENU_ITEM}><Icon name="Plus" aria-hidden />New Space</ContextMenu.Item>
            <ContextMenu.Item onSelect={() => { setCurrentSpaceId(space.id); openOffice("settings"); }} className={MENU_ITEM}><Icon name="SlidersHorizontal" aria-hidden />Space settings</ContextMenu.Item>
            {space.isDefault ? null : <>
              <ContextMenu.Separator className={MENU_SEPARATOR} />
              <ContextMenu.Item onSelect={remove} className={cn(MENU_ITEM, "text-destructive [&_svg]:text-destructive")}><Icon name="Trash2" aria-hidden />Delete Space…</ContextMenu.Item>
            </>}
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      <Popover.Portal>
        <Popover.Content {...PORTAL_SCOPE} side="top" sideOffset={8} className="z-50 rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-lg outline-none">
          {editing
            ? <SpaceField
                label={editing === "name" ? "Space name" : "Space icon (an emoji)"}
                initial={editing === "name" ? space.name : space.icon ?? ""}
                narrow={editing === "icon"}
                onDone={(value) => {
                  setEditing(null);
                  if (value === null) return;
                  if (editing === "name" && value && value !== space.name) update({ name: value });
                  if (editing === "icon") update({ icon: value || null });
                }}
              />
            : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function SpaceField({ label, initial, narrow, onDone }: { label: string; initial: string; narrow: boolean; onDone: (value: string | null) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <input
      autoFocus
      aria-label={label}
      placeholder={narrow ? "🙂" : "Name"}
      value={value}
      maxLength={narrow ? 8 : 100}
      onChange={(change) => setValue(change.target.value)}
      onFocus={(focus) => focus.currentTarget.select()}
      onKeyDown={(key) => {
        if (key.key === "Enter") onDone(value.trim());
        if (key.key === "Escape") onDone(null);
      }}
      className={cn("h-8 rounded-md border border-border bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring", narrow ? "w-16 text-center" : "w-48")}
    />
  );
}

/** A dragged Space mark lands before or after the mark under the pointer. */
function spaceTargetAt(x: number, y: number, dragged: string): DropTarget | null {
  const mark = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-space-mark]");
  const id = mark?.dataset.spaceMark;
  if (!mark || !id || `space:${id}` === dragged) return null;
  const others = [...document.querySelectorAll<HTMLElement>("[data-space-mark]")].map((other) => other.dataset.spaceMark!).filter((other) => `space:${other}` !== dragged);
  const box = mark.getBoundingClientRect();
  const after = x > box.left + box.width / 2;
  return { zone: "pinned", folderId: null, index: others.indexOf(id) + (after ? 1 : 0), beside: { ref: `space:${id}`, after }, zoneKey: "spaces" };
}

function SpacesFooter() {
  const { spaces, current, refresh } = useSpaces();
  const [routing, setRouting] = useState<Routing>(readRouting);
  const counts = useInboxCounts();
  const { items, actions } = useSidebarNavigation();
  const bbRows = items.filter((item) => item.pluginId === null && BB_ROWS.test(item.id) && !item.isDisabled);
  return (
    <div className="sticky bottom-0 mt-auto flex items-center gap-1 bg-sidebar px-1.5 pt-2 pb-1">
      <button type="button" aria-label="Archived tabs" title="Archived tabs" onClick={() => openCommandBar("archived")} className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-foreground/45 hover:bg-foreground/[0.07] hover:text-foreground [&_svg]:size-4">
        <Icon name="Archive" />
      </button>
      <div role="tablist" aria-label="Spaces" className="flex min-w-0 flex-1 items-center justify-center gap-1.5 overflow-x-auto">
        {spaces.map((space) => (
          <SpaceMarkButton key={space.id} space={space} isCurrent={space.id === current?.id} waiting={requestCount(counts.data, space.id)} order={spaces.map((other) => other.id)} onChanged={refresh} />
        ))}
      </div>
      <Menu.Root>
        <Menu.Trigger aria-label="Space menu" className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-foreground/45 outline-none hover:bg-foreground/[0.07] hover:text-foreground data-[state=open]:bg-foreground/[0.08] [&_svg]:size-4">
          <Icon name="MoreHorizontal" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content {...PORTAL_SCOPE} side="top" align="end" className={MENU}>
            <Menu.Item onSelect={() => openOffice("settings")} className={MENU_ITEM}><Icon name="SlidersHorizontal" aria-hidden />{current ? `${current.name} settings` : "Space settings"}</Menu.Item>
            <Menu.Item onSelect={() => openOffice("team/new")} className={MENU_ITEM}><Icon name="UserRoundPlus" aria-hidden />Add a bot</Menu.Item>
            <Menu.Item onSelect={() => openOffice("spaces/new")} className={MENU_ITEM}><Icon name="Plus" aria-hidden />New space</Menu.Item>
            <Menu.Separator className={MENU_SEPARATOR} />
            {/* Space routing, like Arc's: open things in the Space they belong to. */}
            <Menu.CheckboxItem
              checked={routing === "own"}
              onCheckedChange={(checked) => { const next = checked ? "own" : "current"; writeRouting(next); setRouting(next); }}
              onSelect={(event) => event.preventDefault()}
              className={MENU_ITEM}
            >
              <span className="inline-flex size-3.5 items-center justify-center"><Menu.ItemIndicator><Icon name="Check" aria-hidden /></Menu.ItemIndicator></span>
              Open things in their own Space
            </Menu.CheckboxItem>
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
  // Split members count as open too: they live inside their split tab.
  const knownRefs = useMemo(() => new Set(all.flatMap((tab) => [tab.ref, ...(tab.members ?? []).map((member) => member.ref)])), [all]);
  const knownHrefs = useMemo(() => new Set(all.flatMap((tab) => [tab, ...(tab.members ?? [])].flatMap((one) => (one.href ? [one.href] : [])))), [all]);
  useTrackOpen(spaceId, activeThreadId, knownHrefs, knownRefs, tabs.refresh);

  // A folder being named in place: a new one (filing `withRef` when set), or a rename.
  const [naming, setNaming] = useState<{ withRef?: string } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  // A split you separate stays separated while those panes are still open.
  const [separated, setSeparated] = useState<string | null>(null);
  const moves: TabMoves = useMemo(() => ({
    ...actions,
    newFolder: (withRef: string) => setNaming({ withRef }),
    separate: (ref: string) => {
      const split = [...tabs.essentials, ...tabs.pinned, ...tabs.today].find((tab) => tab.ref === ref);
      if (split?.members) setSeparated(split.members.map((member) => member.ref).join(","));
      actions.separate(ref);
    },
  }), [actions, tabs.essentials, tabs.pinned, tabs.today]);
  const open = (tab: ShownTab, options: { split: boolean }) => { openTab(tab, threadActions, options); onNavigate(); };
  // Threads open side by side become one split tab, as in Arc; it stays after
  // the split closes, so you can come back to the pair.
  const layout = useSidebarSplitLayout();
  const paneRefs = (layout?.panes ?? [])
    .filter((pane) => pane.threadId)
    .sort((a, b) => a.rect.x - b.rect.x || a.rect.y - b.rect.y)
    .map((pane) => threadRef(pane.threadId!));
  const paneKey = paneRefs.join(",");
  const splitKeys = useMemo(() => new Set(all.flatMap((tab) => (tab.members ? [tab.members.map((member) => member.ref).join(",")] : []))), [all]);
  useEffect(() => {
    if (paneRefs.length < 2 || splitKeys.has(paneKey) || paneKey === separated) return;
    // Wait for the layout to settle: a drag passes through several.
    const timer = setTimeout(() => actions.keepSplit(paneRefs), 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- paneKey stands for paneRefs
  }, [paneKey, splitKeys, separated, actions]);

  // ⌘⇧T, and Reopen closed tab in the menus: the tab closed last comes back and opens.
  const reopen = useCallback(() => {
    void actions.reopen().then((tab) => {
      if (tab) openTab(shownTab(tab), threadActions);
    }, () => undefined);
  }, [actions, threadActions]);
  useEffect(() => {
    globalThis.addEventListener?.(REOPEN_EVENT, reopen);
    return () => globalThis.removeEventListener?.(REOPEN_EVENT, reopen);
  }, [reopen]);
  const { spaces } = useSpaces();
  const otherSpaces = useMemo(() => spaces.filter((space) => space.id !== spaceId), [spaces, spaceId]);
  const listOf = (tab: ShownTab) => (tab.zone === "today" ? tabs.today : tabs.pinned.filter((other) => other.folderId === tab.folderId)).map((other) => other.ref);
  const row = (tab: ShownTab, indent = false) => (
    <TabRow
      key={tab.ref}
      tab={tab}
      indent={indent}
      active={isTabActive(tab, activeThreadId, locationHref)}
      folders={tabs.folders}
      moves={moves}
      context={{ siblings: listOf(tab), essentialsCount: tabs.essentials.length, spaces: otherSpaces }}
      onOpen={open}
    />
  );

  const loose = tabs.pinned.filter((tab) => !tab.folderId);
  const folders = [...tabs.folders].sort((a, b) => a.position - b.position);

  return (
    // Right-click empty sidebar space for the sidebar's own actions; a tab's
    // or folder's menu takes precedence over this one.
    <ContextMenu.Root>
    <ContextMenu.Trigger asChild>
    <div className="flex min-h-full flex-col px-2">
      <SectionEdge
        label={current?.name ?? "Pinned"}
        zone="pinned"
        action={
          <button
            type="button"
            aria-label="New folder"
            title="New folder"
            onClick={() => setNaming({})}
            className="inline-flex size-5 items-center justify-center rounded text-foreground/45 opacity-0 hover:bg-foreground/[0.07] hover:text-foreground focus-visible:opacity-100 group-hover/divider:opacity-100 [&_svg]:size-3.5"
          >
            <Icon name="FolderPlus" />
          </button>
        }
      />
      <div className="space-y-px">
        {/* Loose tabs first, so dropping on "Pinned" lands right under it. */}
        {loose.map((tab) => row(tab))}
        {folders.map((folder) => (
          <div key={folder.id} className="space-y-px">
            <FolderRow
              folder={folder}
              renaming={renaming === folder.id}
              onToggle={() => actions.updateFolder(folder.id, { open: !folder.open })}
              onStartRename={() => setRenaming(folder.id)}
              onRename={(name) => { setRenaming(null); if (name && name !== folder.name) actions.updateFolder(folder.id, { name }); }}
              onDelete={() => actions.deleteFolder(folder.id)}
              onMove={(position) => actions.updateFolder(folder.id, { position })}
            />
            {folder.open ? tabs.pinned.filter((tab) => tab.folderId === folder.id).map((tab) => row(tab, true)) : null}
          </div>
        ))}
        {naming
          ? <FolderNameField initial="" onDone={(name) => { setNaming(null); if (name) actions.createFolder(name, naming.withRef); }} />
          : null}
      </div>

      <SectionEdge
        zone="today"
        action={tabs.today.length
          ? <button type="button" onClick={() => actions.closeMany(tabs.today.map((tab) => tab.ref))} className="rounded px-1 text-xs text-foreground/45 opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover/divider:opacity-100">Clear</button>
          : null}
      />
      <div className="space-y-px">
        {/* New tab heads today's tabs, which run newest first below it. */}
        <button type="button" onClick={() => openCommandBar()} data-tab-drop-zone="" data-zone="today" data-at="start" className={cn(TAB, "text-foreground/60")}>
          <span aria-hidden className="inline-flex size-5 shrink-0 items-center justify-center [&_svg]:size-4"><Icon name="Plus" /></span>
          <span className="min-w-0 flex-1 truncate">New tab</span>
        </button>
        {tabs.today.map((tab) => row(tab))}
      </div>

      <SpacesFooter />
      <DragGhost />
    </div>
    </ContextMenu.Trigger>
    <ContextMenu.Portal>
      <ContextMenu.Content {...PORTAL_SCOPE} className={MENU} onCloseAutoFocus={(event) => event.preventDefault()}>
        <ContextMenu.Item onSelect={() => openCommandBar()} className={MENU_ITEM}><Icon name="Plus" aria-hidden />New tab<span className="ml-auto pl-4 text-xs text-subtle-foreground">⌘T</span></ContextMenu.Item>
        <ContextMenu.Item onSelect={() => setNaming({})} className={MENU_ITEM}><Icon name="FolderPlus" aria-hidden />New folder</ContextMenu.Item>
        <ContextMenu.Item onSelect={reopen} className={MENU_ITEM}><Icon name="RotateCcw" aria-hidden />Reopen closed tab<span className="ml-auto pl-4 text-xs text-subtle-foreground">⌘⇧T</span></ContextMenu.Item>
        <ContextMenu.Separator className={MENU_SEPARATOR} />
        <ContextMenu.Item onSelect={() => openOffice("settings")} className={MENU_ITEM}><Icon name="SlidersHorizontal" aria-hidden />Space settings</ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

const REOPEN_EVENT = "bb-studio:office-reopen-tab";
/** Reopens the tab closed last, from anywhere (the ⌘⇧T command). */
export function reopenClosedTab(): void {
  globalThis.dispatchEvent?.(new Event(REOPEN_EVENT));
}
