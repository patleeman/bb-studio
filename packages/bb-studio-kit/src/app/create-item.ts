// Every Studio "New" menu makes items here, so each kind behaves the same
// from the sidebar, a Space, a collection or Quick Open: the item is made in
// the project the menu chose, then opens in the main pane.
import { toast } from "sonner";
import type { StudioCreateEventDetail, StudioKind } from "../contract";
import { errorMessage } from "../format";
import { openAppPath } from "./nav";

export interface CreateStudioItemOptions {
  projectId: string | null;
  /** The add-on's name, for "isn't loaded yet". */
  addOn: string;
  /** Makes an "rpc" kind's item and returns its href. */
  create(): Promise<string>;
  /** Opens the new item; the main pane by default. */
  open?(href: string): void;
}

/** Makes one item of `kind` and opens it. Reports failures as toasts. */
export async function createStudioItem(kind: Pick<StudioKind, "label" | "create">, options: CreateStudioItemOptions): Promise<void> {
  const open = options.open ?? ((href: string) => openAppPath(href, { main: true }));
  if (!kind.create) return;
  if (kind.create.mode === "event") {
    // Made in the browser, like a Talk recording: the add-on's frontend makes it and reports back.
    const detail: StudioCreateEventDetail = { projectId: options.projectId, opened: open };
    const event = new CustomEvent<StudioCreateEventDetail>(kind.create.event, { detail, cancelable: true });
    window.dispatchEvent(event);
    if (!event.defaultPrevented) toast.error(`${options.addOn} isn't loaded yet. Reload BB and try again.`);
    return;
  }
  try {
    open(await options.create());
  } catch (cause) {
    toast.error(`Couldn't create a ${kind.label.toLowerCase()}: ${errorMessage(cause)}`);
  }
}
