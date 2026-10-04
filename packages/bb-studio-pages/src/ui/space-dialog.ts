// Studio owns spaces; a page asks it to edit or delete the space it belongs to.
import { toast } from "sonner";

const SPACE_DIALOG_EVENT = "studio:space-dialog";

/** Opens one of Studio's dialogs for the space. */
export function spaceDialog(spaceId: string, dialog: "edit" | "delete" | "items" | "threads" | "channels" | "projects") {
  const event = new CustomEvent(SPACE_DIALOG_EVENT, { detail: { spaceId, dialog }, cancelable: true });
  window.dispatchEvent(event);
  if (!event.defaultPrevented) toast.error("Studio isn't available to change the space.");
}
