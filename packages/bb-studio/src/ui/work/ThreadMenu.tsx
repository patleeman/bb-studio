// A thread row's actions, from right-click or the row's ⋯ button, in the
// order BB's own sidebar uses (split; link, read, pin, move, rename; archive,
// delete), with "Move to project" where BB has "Move to section". Rows also
// get BB's hover Archive button.
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Menu from "@radix-ui/react-dropdown-menu";
import {
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@bb-studio/kit/app";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { MENU, MENU_ITEM, MENU_SEPARATOR, ROW, cn, PORTAL_SCOPE } from "./styles";

export type MenuEntry =
  | { id: string; label: string; icon: string; danger?: boolean; checked?: boolean; disabled?: boolean; run: () => void }
  | { id: string; label: string; icon: string; submenu: MenuEntry[][] };

/** Where "Move to project" can send a thread. */
export interface MoveTarget { id: string | null; name: string; current: boolean }

export function threadLink(threadId: string): string {
  return `${globalThis.location?.origin ?? ""}/threads/${threadId}`;
}

function useThreadItems(thread: PluginSidebarThread, onRename: () => void, moveTargets: MoveTarget[] | null, onMove: (projectId: string | null) => void): MenuEntry[][] {
  const actions = useSidebarThreadActions();
  return [
    [{ id: "split", label: "Open in split", icon: "Columns2", run: () => actions.open(thread.id, { split: true }) }],
    [
      { id: "link", label: "Copy thread link", icon: "Copy", run: () => void navigator.clipboard?.writeText(threadLink(thread.id)) },
      { id: "read", label: thread.isUnread ? "Mark read" : "Mark unread", icon: thread.isUnread ? "MailOpen" : "Mail", run: () => void actions.setRead(thread.id, thread.isUnread) },
      { id: "pin", label: thread.isPinned ? "Unpin" : "Pin", icon: thread.isPinned ? "PinOff" : "Pin", run: () => void actions.setPinned(thread.id, !thread.isPinned) },
      ...(moveTargets
        ? [{ id: "move", label: "Move to project", icon: "MoveTo", submenu: [moveTargets.map((target) => ({ id: target.id ?? "none", label: target.name, icon: target.id ? "Folder" : "MessageSquare", checked: target.current, run: () => onMove(target.id) }))] }]
        : []),
      { id: "rename", label: "Rename", icon: "Edit", run: onRename },
    ],
    [
      { id: "archive", label: "Archive", icon: "Archive", run: () => actions.archive(thread.id) },
      { id: "delete", label: "Delete", icon: "Trash2", danger: true, run: () => actions.requestDelete(thread.id) },
    ],
  ];
}

type Parts = typeof Menu | typeof ContextMenu;

/** One menu body for both the ⋯ dropdown and right-click. */
export function MenuBody({ parts: P, groups }: { parts: Parts; groups: MenuEntry[][] }) {
  return (
    <>
      {groups.map((group, index) => (
        <div key={index}>
          {index > 0 ? <P.Separator className={MENU_SEPARATOR} /> : null}
          {group.map((entry) => "submenu" in entry
            ? (
              <P.Sub key={entry.id}>
                <P.SubTrigger className={MENU_ITEM}><Icon name={entry.icon} aria-hidden />{entry.label}<Icon name="ChevronRight" className="ml-auto" aria-hidden /></P.SubTrigger>
                <P.Portal>
                  <P.SubContent {...PORTAL_SCOPE} className={cn(MENU, "max-h-80 overflow-y-auto")}>
                    <MenuBody parts={P} groups={entry.submenu} />
                  </P.SubContent>
                </P.Portal>
              </P.Sub>
            )
            : (
              <P.Item key={entry.id} disabled={entry.disabled} onSelect={entry.run} className={cn(MENU_ITEM, entry.danger && "text-destructive [&_svg]:text-destructive")}>
                <Icon name={entry.icon} aria-hidden /><span className="min-w-0 flex-1 truncate">{entry.label}</span>
                {entry.checked ? <Icon name="Check" className="ml-auto" aria-hidden /> : null}
              </P.Item>
            ))}
        </div>
      ))}
    </>
  );
}

/** Right-click anywhere on `children`, plus hover buttons at the row's end. */
export function RowMenu({ label, groups, children, hoverActions }: { label: string; groups: MenuEntry[][]; children: ReactNode; hoverActions?: ReactNode }) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div className="group/thread relative">
          {children}
          <div className="absolute top-1/2 right-1 hidden -translate-y-1/2 items-center gap-0.5 rounded-md bg-sidebar-accent group-hover/thread:flex has-[[data-state=open]]:flex has-[:focus-visible]:flex">
            {hoverActions}
            <Menu.Root>
              <Menu.Trigger aria-label={`Actions for ${label}`} title="Actions" className="inline-flex size-6 items-center justify-center rounded-md text-subtle-foreground hover:text-muted-foreground">
                <Icon name="MoreHorizontal" className="size-4" />
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Content {...PORTAL_SCOPE} align="end" className={MENU}><MenuBody parts={Menu} groups={groups} /></Menu.Content>
              </Menu.Portal>
            </Menu.Root>
          </div>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content {...PORTAL_SCOPE} className={MENU}><MenuBody parts={ContextMenu} groups={groups} /></ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

export function ThreadMenu({ thread, moveTargets, onMove, children }: {
  thread: PluginSidebarThread;
  moveTargets: MoveTarget[] | null;
  onMove: (projectId: string | null) => void;
  children: (rename: ReactNode | null) => ReactNode;
}) {
  const actions = useSidebarThreadActions();
  const [renaming, setRenaming] = useState(false);
  const groups = useThreadItems(thread, () => setRenaming(true), moveTargets, onMove);
  if (renaming) return <RenameField thread={thread} onDone={() => setRenaming(false)} />;
  return (
    <RowMenu
      label={thread.displayTitle}
      groups={groups}
      hoverActions={<button type="button" aria-label="Archive thread" title="Archive" onClick={() => actions.archive(thread.id)} className="inline-flex size-6 items-center justify-center rounded-md text-subtle-foreground hover:text-muted-foreground"><Icon name="Archive" className="size-3.5" /></button>}
    >
      {children(null)}
    </RowMenu>
  );
}

export function RenameField({ thread, onDone, className = "pl-7" }: { thread: PluginSidebarThread; onDone: () => void; className?: string }) {
  const actions = useSidebarThreadActions();
  const [value, setValue] = useState(thread.title ?? thread.displayTitle);
  const input = useRef<HTMLInputElement>(null);
  // Focus after the menu that opened this has closed; a blur before then isn't "done".
  const focused = useRef(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => { input.current?.focus(); input.current?.select(); });
    return () => cancelAnimationFrame(frame);
  }, []);
  const save = () => {
    const title = value.trim();
    if (title && title !== thread.displayTitle) void actions.rename(thread.id, title);
    onDone();
  };
  return (
    <div className={cn(ROW, "bg-foreground/[0.08]", className)}>
      <input
        ref={input}
        aria-label="Thread title"
        value={value}
        onChange={(change) => setValue(change.target.value)}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { if (focused.current) save(); }}
        onKeyDown={(key) => {
          if (key.key === "Enter") save();
          if (key.key === "Escape") onDone();
        }}
        className="h-6 min-w-0 flex-1 rounded-sm bg-foreground/[0.06] px-1 text-sm outline-none ring-1 ring-ring"
      />
    </div>
  );
}
