// "Open in new window" for an item's menus, on a BB with plugin windows
// (windows.ts). The kit only knows an item by its link; Studio lends the
// opener that knows which links are items it can show in a window
// (src/ui/item-window.tsx). With no opener, the entry isn't drawn.
import { toast } from "sonner";
import { DropdownMenuItem } from "../ui/dropdown-menu";
import { Icon } from "../ui/icon";
import { useHostWindows, type HostWindows } from "./windows";

export interface ItemWindowOpener {
  /** Whether the link is an item that has a window. */
  canOpen(href: string): boolean;
  /** Opens the item's window, or brings the one it has forward. */
  open(windows: HostWindows, item: { href: string; title?: string }): Promise<boolean>;
}

let opener: ItemWindowOpener | null = null;

export function setItemWindowOpener(next: ItemWindowOpener | null): void {
  opener = next;
}

/** Whether `href` gets the menu entry: only with an opener, and only for its items. */
export function canOpenInWindow(href: string | null | undefined): boolean {
  return !!href && !!opener?.canOpen(href);
}

/** Opens the item at `href` in a window of its own. False when it has none (no opener, not such an item) or the window didn't open. */
export function openInWindow(windows: HostWindows, item: { href: string; title?: string }): Promise<boolean> {
  return opener && opener.canOpen(item.href) ? opener.open(windows, item) : Promise.resolve(false);
}

export function OpenInWindowMenuItem({ href, title }: { href: string | null | undefined; title?: string }) {
  const windows = useHostWindows();
  if (!href || !canOpenInWindow(href)) return null;
  const open = () => void opener?.open(windows, { href, ...(title ? { title } : {}) }).then(
    (opened) => { if (!opened) toast.error("Couldn't open a window."); },
    () => toast.error("Couldn't open a window."),
  );
  return (
    <DropdownMenuItem onSelect={open}>
      <Icon name="AppWindow" className="size-4" /> Open in new window
    </DropdownMenuItem>
  );
}
