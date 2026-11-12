// Test doubles for the kit's Radix menus, dialogs and popovers: everything
// renders inline, menu items are buttons, and a popover opens on its trigger.
import { createContext, useContext, type ReactNode } from "react";

const box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
const PopoverOpen = createContext<{ open: boolean; set(open: boolean): void }>({ open: true, set: () => {} });

export const kitUi = {
  cn: (...names: unknown[]) => names.filter(Boolean).join(" "),
  Icon: ({ name }: { name: string }) => <i data-icon={name} />,
  DropdownMenu: box, DropdownMenuContent: box, DropdownMenuTrigger: box, DropdownMenuSeparator: () => <hr />,
  DropdownMenuSub: box, DropdownMenuSubContent: box,
  DropdownMenuSubTrigger: ({ children }: { children?: ReactNode }) => <div role="group">{children}</div>,
  DropdownMenuLabel: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect }: { children?: ReactNode; onSelect?(): void }) => <button type="button" role="menuitem" onClick={() => onSelect?.()}>{children}</button>,
  Dialog: box, DialogContent: box, DialogHeader: box, DialogFooter: box, DialogTitle: box,
  Popover: ({ open, onOpenChange, children }: { open?: boolean; onOpenChange?(open: boolean): void; children?: ReactNode }) =>
    <PopoverOpen.Provider value={{ open: open ?? false, set: (value) => onOpenChange?.(value) }}>{children}</PopoverOpen.Provider>,
  PopoverTrigger: ({ children }: { children?: ReactNode }) => {
    const popover = useContext(PopoverOpen);
    return <span onClickCapture={() => popover.set(true)}>{children}</span>;
  },
  PopoverContent: ({ children }: { children?: ReactNode }) => useContext(PopoverOpen).open ? <div>{children}</div> : null,
  Checkbox: ({ checked, onCheckedChange, ...props }: { checked?: boolean; onCheckedChange?(value: boolean): void }) =>
    <input type="checkbox" checked={!!checked} onChange={(event) => onCheckedChange?.(event.target.checked)} {...props} />,
};
