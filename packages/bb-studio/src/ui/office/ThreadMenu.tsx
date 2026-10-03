// A thread row's actions, from right-click or the row's ⋯ button: the same
// set BB's own sidebar offers (favorite, read state, rename, split, archive,
// delete), so moving to the office sidebar loses nothing.
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Menu from "@radix-ui/react-dropdown-menu";
import {
  experimental_useSidebarThreadActions as useSidebarThreadActions,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@bb-studio/kit/app";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { MENU, MENU_ITEM, MENU_SEPARATOR, ROW, cn, PORTAL_SCOPE } from "./styles";

type Item = { id: string; label: string; icon: string; danger?: boolean; run: () => void };

function useThreadItems(thread: PluginSidebarThread, onRename: () => void): Item[][] {
  const actions = useSidebarThreadActions();
  return [
    [
      { id: "split", label: "Open in split", icon: "Columns2", run: () => actions.open(thread.id, { split: true }) },
      { id: "pin", label: thread.isPinned ? "Remove from favorites" : "Add to favorites", icon: "Star", run: () => void actions.setPinned(thread.id, !thread.isPinned) },
      { id: "read", label: thread.isUnread ? "Mark as read" : "Mark as unread", icon: thread.isUnread ? "MailOpen" : "Mail", run: () => void actions.setRead(thread.id, thread.isUnread) },
      { id: "rename", label: "Rename", icon: "Edit", run: onRename },
    ],
    [
      { id: "archive", label: "Archive", icon: "Archive", run: () => actions.archive(thread.id) },
      { id: "delete", label: "Delete…", icon: "Trash2", danger: true, run: () => actions.requestDelete(thread.id) },
    ],
  ];
}

/** Wraps a thread row with right-click actions and a ⋯ button on hover. */
export function ThreadMenu({ thread, children }: { thread: PluginSidebarThread; children: (rename: ReactNode | null) => ReactNode }) {
  const [renaming, setRenaming] = useState(false);
  const groups = useThreadItems(thread, () => setRenaming(true));
  const editor = renaming ? <RenameField thread={thread} onDone={() => setRenaming(false)} /> : null;
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div className="group/thread relative">
          {children(editor)}
          {editor ? null : (
            <Menu.Root>
              <Menu.Trigger
                aria-label={`Actions for ${thread.displayTitle}`}
                className="absolute top-1/2 right-1 hidden size-6 -translate-y-1/2 items-center justify-center rounded-md bg-sidebar-accent text-subtle-foreground hover:text-muted-foreground group-hover/thread:flex focus-visible:flex data-[state=open]:flex"
              >
                <Icon name="MoreHorizontal" className="size-4" />
              </Menu.Trigger>
              <Menu.Portal>
                <Menu.Content {...PORTAL_SCOPE} align="end" className={MENU}>
                  {groups.map((group, index) => (
                    <div key={index}>
                      {index > 0 ? <Menu.Separator className={MENU_SEPARATOR} /> : null}
                      {group.map((item) => (
                        <Menu.Item key={item.id} onSelect={item.run} className={cn(MENU_ITEM, item.danger && "text-destructive [&_svg]:text-destructive")}>
                          <Icon name={item.icon} aria-hidden />{item.label}
                        </Menu.Item>
                      ))}
                    </div>
                  ))}
                </Menu.Content>
              </Menu.Portal>
            </Menu.Root>
          )}
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content {...PORTAL_SCOPE} className={MENU}>
          {groups.map((group, index) => (
            <div key={index}>
              {index > 0 ? <ContextMenu.Separator className={MENU_SEPARATOR} /> : null}
              {group.map((item) => (
                <ContextMenu.Item key={item.id} onSelect={item.run} className={cn(MENU_ITEM, item.danger && "text-destructive [&_svg]:text-destructive")}>
                  <Icon name={item.icon} aria-hidden />{item.label}
                </ContextMenu.Item>
              ))}
            </div>
          ))}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

export function RenameField({ thread, onDone, className = "pl-7" }: { thread: PluginSidebarThread; onDone: () => void; className?: string }) {
  const actions = useSidebarThreadActions();
  const [value, setValue] = useState(thread.title ?? thread.displayTitle);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.select(); }, []);
  const save = () => {
    const title = value.trim();
    if (title && title !== thread.displayTitle) void actions.rename(thread.id, title);
    onDone();
  };
  return (
    <div className={cn(ROW, "bg-sidebar-accent", className)}>
      <input
        ref={input}
        aria-label="Thread title"
        value={value}
        onChange={(change) => setValue(change.target.value)}
        onBlur={save}
        onKeyDown={(key) => {
          if (key.key === "Enter") save();
          if (key.key === "Escape") onDone();
        }}
        className="h-6 min-w-0 flex-1 rounded-sm bg-background px-1 text-sm outline-none ring-1 ring-ring"
      />
    </div>
  );
}
