// One tab: a big row with the thing's face or icon, its title, its state on
// the right, and × on hover to archive it. Right-click for everything else.
// Archiving a tab only takes it out of the sidebar; the thread or page stays.
// Drag a tab to reorder it or move it between sections (tabDrag.ts); drag a
// thread out to the page to open it in a split.
import * as ContextMenu from "@radix-ui/react-context-menu";
import {
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  experimental_useSidebarThreadSplit as useSidebarThreadSplit,
} from "@get-bb/plugin-sdk/app";
import { Icon, copyReferenceWithToast, openAppPath } from "@bb-studio/kit/app";
import { useCallback, useState, type ReactNode } from "react";
import { RUNNING } from "./activeWork";
import { useTabDrag, useTabDragState, type DropTarget } from "./tabDrag";
import { Face } from "./Face";
import { externalAgentName } from "./external";
import { useCall } from "./model";
import { ProviderBadge } from "./ProviderBadge";
import type { ShownTab, TabFolder, TabZone } from "./tabs";
import { RenameField } from "./ThreadMenu";
import { MENU, MENU_ITEM, MENU_SEPARATOR, PORTAL_SCOPE, cn } from "./styles";

export const KIND_ICONS: Record<string, string> = {
  thread: "MessageSquare",
  page: "FileText",
  board: "GridView",
  task: "CircleCheck",
  table: "ListView",
  drawing: "Palette",
  recording: "Mic",
  dictation: "Mic",
  artifact: "PackageReceive",
  inbox: "studio/inbox",
  home: "studio/home",
  library: "Layers",
  folder: "Folder",
};

export const TAB =
  "group/tab relative flex h-9 w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 text-left text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring max-md:pointer-coarse:h-11";

export const TAB_ACTIVE = "bg-background text-foreground shadow-sm ring-1 ring-border/60 hover:bg-background";

/** The tab's picture: a bot's face, a channel's #, an item's emoji, or its kind icon. */
export function TabGlyph({ tab, size = "sm" }: { tab: ShownTab; size?: "sm" | "md" }) {
  if (tab.kind === "bot") {
    const agent = externalAgentName(tab.providerId);
    return (
      <Face
        name={tab.title}
        avatar={tab.icon}
        state={tab.botState}
        size={size}
        external={agent}
        badge={agent && tab.providerId ? <ProviderBadge providerId={tab.providerId} label={`${agent} agent`} className="size-full" /> : null}
      />
    );
  }
  const box = size === "md" ? "size-6 text-lg [&_svg]:size-5" : "size-5 text-[15px] [&_svg]:size-4";
  if (tab.kind === "conversation") return <span aria-hidden className={cn("inline-flex shrink-0 items-center justify-center font-medium text-subtle-foreground", box)}>#</span>;
  if (tab.icon && tab.kind === "item") return <span aria-hidden className={cn("inline-flex shrink-0 items-center justify-center leading-none", box)}>{tab.icon}</span>;
  const name = KIND_ICONS[tab.kind === "item" ? tab.itemKind ?? "" : tab.kind] ?? "File";
  return <span aria-hidden className={cn("inline-flex shrink-0 items-center justify-center text-subtle-foreground", box)}><Icon name={name} /></span>;
}

/** What needs saying at the tab's right edge, most urgent first. */
function TabState({ tab }: { tab: ShownTab }) {
  const running = tab.thread && RUNNING.has(tab.thread.runtimeStatus);
  if (tab.badge) return <span className="shrink-0 rounded-full bg-foreground px-1.5 text-[11px] font-semibold leading-[18px] tabular-nums text-background">{tab.badge}</span>;
  if (tab.needsYou) return <span aria-label="Needs you" className="size-2 shrink-0 rounded-full bg-warning-foreground" />;
  if (running) return <span aria-label="Running" className="size-3 shrink-0 rounded-full border-[1.5px] border-muted-foreground/60 border-r-transparent motion-safe:animate-spin" />;
  if (tab.unread) return <span aria-label="Unread" className="size-1.5 shrink-0 rounded-full bg-foreground" />;
  return null;
}

export function openTab(tab: ShownTab, threadActions: ReturnType<typeof useSidebarThreadActions>, options: { split?: boolean } = {}) {
  // Search results for threads carry only their ref; opening one also brings
  // it back from BB's archive (tabs_open does that on the way in).
  const threadId = tab.thread?.id ?? (tab.ref.startsWith("thread:") ? tab.ref.slice("thread:".length) : null);
  if (threadId) threadActions.open(threadId, { split: options.split ?? false });
  else if (tab.href) openAppPath(tab.href, { main: true });
}

export interface TabMoves {
  move: (ref: string, zone: TabZone, options?: { folderId?: string | null; index?: number }) => void;
  archive: (ref: string) => void;
  /** Starts naming a new Pinned folder in place; the tab goes in it. */
  newFolder: (withRef: string) => void;
}

interface Action { id: string; label: string; icon: string; danger?: boolean; run: () => void }

function useTabMenu(tab: ShownTab, folders: readonly TabFolder[], moves: TabMoves, onRename: () => void): { groups: Action[][]; folderMoves: Action[] } {
  const threadActions = useSidebarThreadActions();
  const call = useCall();
  const thread = tab.thread;
  const pinned = tab.zone === "pinned";
  const essential = tab.zone === "essential";
  const [, pluginId, itemId] = tab.kind === "item" ? tab.ref.split(":") : [];
  const groups: Action[][] = [
    thread ? [{ id: "split", label: "Open in split", icon: "Columns2", run: () => openTab(tab, threadActions, { split: true }) }] : [],
    [
      { id: "pin", label: pinned ? "Unpin" : "Pin", icon: "Pin", run: () => moves.move(tab.ref, pinned ? "today" : "pinned") },
      { id: "essential", label: essential ? "Remove from Essentials" : "Add to Essentials", icon: "Star", run: () => moves.move(tab.ref, essential ? "pinned" : "essential") },
    ],
    [
      ...(thread
        ? [
            { id: "read", label: thread.isUnread ? "Mark as read" : "Mark as unread", icon: thread.isUnread ? "MailOpen" : "Mail", run: () => void threadActions.setRead(thread.id, thread.isUnread) },
            { id: "rename", label: "Rename", icon: "Edit", run: onRename },
          ]
        : []),
      {
        id: "copy",
        label: "Copy link",
        icon: "Link",
        run: () => {
          if (thread) void navigator.clipboard.writeText(`@thread:${thread.id}`);
          else if (tab.href) copyReferenceWithToast({ href: tab.href, title: tab.title, ...(tab.icon && tab.kind === "item" ? { icon: tab.icon } : {}) });
        },
      },
    ],
    [
      { id: "archive", label: "Archive tab", icon: "Archive", run: () => moves.archive(tab.ref) },
      ...(thread
        ? [{ id: "delete", label: "Delete thread…", icon: "Trash2", danger: true, run: () => threadActions.requestDelete(thread.id) }]
        : pluginId && itemId
          ? [{
              id: "delete",
              label: "Delete…",
              icon: "Trash2",
              danger: true,
              run: () => { if (confirm(`Delete “${tab.title}”? This can't be undone.`)) void call("remove", { pluginId, ids: [itemId] }).then(() => moves.archive(tab.ref)); },
            }]
          : []),
    ],
  ];
  const folderMoves: Action[] = [
    ...folders.filter((folder) => folder.id !== tab.folderId).map((folder) => ({ id: folder.id, label: folder.name, icon: "Folder", run: () => moves.move(tab.ref, "pinned", { folderId: folder.id }) })),
    ...(tab.folderId ? [{ id: "out", label: "Out of folder", icon: "ArrowUp", run: () => moves.move(tab.ref, "pinned", { folderId: null }) }] : []),
    { id: "new", label: "New folder…", icon: "Plus", run: () => moves.newFolder(tab.ref) },
  ];
  return { groups, folderMoves };
}

/** Where a dragged tab will land: a line on the row's top or bottom edge. */
export function DropLine({ after, axis = "y" }: { after: boolean; axis?: "x" | "y" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute z-10 rounded-full bg-ring",
        axis === "y" ? cn("inset-x-1 h-0.5", after ? "-bottom-px" : "-top-px") : cn("inset-y-1 w-0.5", after ? "-right-1" : "-left-1"),
      )}
    />
  );
}

export function TabRow({ tab, active, folders, moves, indent, onOpen, trailing }: {
  tab: ShownTab;
  active: boolean;
  folders: readonly TabFolder[];
  moves: TabMoves;
  indent?: boolean;
  onOpen: (tab: ShownTab, options: { split: boolean }) => void;
  trailing?: ReactNode;
}) {
  const [renaming, setRenaming] = useState(false);
  const { groups, folderMoves } = useTabMenu(tab, folders, moves, () => setRenaming(true));
  const split = useSidebarThreadSplit(tab.thread?.id ?? "");
  const drop = useCallback((target: DropTarget) => moves.move(tab.ref, target.zone, { folderId: target.folderId, index: target.index }), [moves, tab.ref]);
  const startDrag = useTabDrag(tab, drop, split.splitProps.onPointerDown);
  const drag = useTabDragState();
  const dragging = drag?.ref === tab.ref;
  const beside = drag?.target?.beside?.ref === tab.ref ? drag.target.beside : null;
  if (renaming && tab.thread) return <RenameField thread={tab.thread} onDone={() => setRenaming(false)} className={cn("h-9 rounded-lg", indent ? "pl-8" : "pl-2.5")} />;
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div
          className={cn("group/tab relative", dragging && "opacity-40")}
          data-tab-drop-row=""
          data-ref={tab.ref}
          data-zone={tab.zone}
          data-folder={tab.folderId ?? ""}
          data-axis="y"
        >
          {beside ? <DropLine after={beside.after} /> : null}
          <button
            type="button"
            onPointerDown={startDrag}
            onClick={(event) => onOpen(tab, { split: event.metaKey || event.ctrlKey })}
            aria-current={active ? "page" : undefined}
            className={cn(TAB, indent && "pl-8", active && TAB_ACTIVE, "group-hover/tab:pr-9")}
          >
            <TabGlyph tab={tab} />
            <span className={cn("min-w-0 flex-1 truncate", tab.unread && "font-medium")}>{tab.title}</span>
            <span className="flex shrink-0 items-center group-hover/tab:hidden">{trailing ?? <TabState tab={tab} />}</span>
          </button>
          <button
            type="button"
            aria-label={`Archive ${tab.title}`}
            title="Archive tab"
            onClick={() => moves.archive(tab.ref)}
            className="absolute top-1/2 right-1.5 hidden size-6 -translate-y-1/2 items-center justify-center rounded-md text-subtle-foreground hover:bg-state-hover hover:text-foreground focus-visible:flex group-hover/tab:flex [&_svg]:size-3.5"
          >
            <Icon name="X" aria-hidden />
          </button>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content {...PORTAL_SCOPE} className={MENU}>
          {groups.filter((group) => group.length).map((group, index) => (
            <div key={index}>
              {index > 0 ? <ContextMenu.Separator className={MENU_SEPARATOR} /> : null}
              {group.map((action) => (
                <ContextMenu.Item key={action.id} onSelect={action.run} className={cn(MENU_ITEM, action.danger && "text-destructive [&_svg]:text-destructive")}>
                  <Icon name={action.icon} aria-hidden />{action.label}
                </ContextMenu.Item>
              ))}
              {/* Folders sit with Pin, where the tab's place in the sidebar is decided. */}
              {group.some((action) => action.id === "pin")
                ? <ContextMenu.Sub>
                    <ContextMenu.SubTrigger className={MENU_ITEM}>
                      <Icon name="Folder" aria-hidden />Move to folder<Icon name="ChevronRight" aria-hidden className="ml-auto" />
                    </ContextMenu.SubTrigger>
                    <ContextMenu.Portal>
                      <ContextMenu.SubContent {...PORTAL_SCOPE} className={MENU}>
                        {folderMoves.map((action) => (
                          <ContextMenu.Item key={action.id} onSelect={action.run} className={MENU_ITEM}>
                            <Icon name={action.icon} aria-hidden />{action.label}
                          </ContextMenu.Item>
                        ))}
                      </ContextMenu.SubContent>
                    </ContextMenu.Portal>
                  </ContextMenu.Sub>
                : null}
            </div>
          ))}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
