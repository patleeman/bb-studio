// Actions for the sidebar's item and folder rows, from right-click or the
// row's ⋯ button. Removing an item from the sidebar archives it: it leaves
// Work and stays in All items, where it can be restored.
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Icon, openAppPath } from "@bb-studio/kit/app";
import type { ReactNode } from "react";
import { useCall, type TreeItem } from "./model";
import { MENU, MENU_ITEM, MENU_SEPARATOR, cn } from "./styles";

export interface RowAction {
  id: string;
  label: string;
  icon: string;
  danger?: boolean;
  run: () => void;
}

/** One menu, shown both on right-click and from a ⋯ button that appears on hover. */
export function RowMenu({ label, groups, children }: { label: string; groups: RowAction[][]; children: ReactNode }) {
  const items = (Item: typeof Menu.Item | typeof ContextMenu.Item, Separator: typeof Menu.Separator | typeof ContextMenu.Separator) =>
    groups.filter((group) => group.length).map((group, index) => (
      <div key={index}>
        {index > 0 ? <Separator className={MENU_SEPARATOR} /> : null}
        {group.map((action) => (
          <Item key={action.id} onSelect={action.run} className={cn(MENU_ITEM, action.danger && "text-destructive [&_svg]:text-destructive")}>
            <Icon name={action.icon} aria-hidden />{action.label}
          </Item>
        ))}
      </div>
    ));
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div className="group/rowmenu relative">
          {children}
          <Menu.Root>
            <Menu.Trigger
              aria-label={`Actions for ${label}`}
              className="absolute top-1/2 right-1 hidden size-6 -translate-y-1/2 items-center justify-center rounded-md bg-sidebar-accent text-subtle-foreground hover:text-muted-foreground group-hover/rowmenu:flex focus-visible:flex data-[state=open]:flex"
            >
              <Icon name="MoreHorizontal" className="size-4" />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Content align="end" className={MENU}>{items(Menu.Item, Menu.Separator)}</Menu.Content>
            </Menu.Portal>
          </Menu.Root>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={MENU}>{items(ContextMenu.Item, ContextMenu.Separator)}</ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/** Open, take it out of the sidebar (archive), or delete. */
export function useItemActions(item: TreeItem, onChanged: () => void): RowAction[][] {
  const call = useCall();
  const name = item.title || "Untitled";
  return [
    [{ id: "open", label: "Open", icon: "ExternalLink", run: () => openAppPath(item.href) }],
    [
      {
        id: "archive",
        label: "Remove from sidebar",
        icon: "Archive",
        run: () => { void call("archive", { pluginId: item.pluginId, ids: [item.id], archived: true }).then(onChanged); },
      },
      {
        id: "delete",
        label: "Delete…",
        icon: "Trash2",
        danger: true,
        run: () => {
          if (confirm(`Delete “${name}”? This can't be undone.`)) void call("remove", { pluginId: item.pluginId, ids: [item.id] }).then(onChanged);
        },
      },
    ],
  ];
}
