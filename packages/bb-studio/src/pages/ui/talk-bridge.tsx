// Opens a page when Talk's "Go back" asks for a dictation field of a page.
import { useEffect } from "react";
import { useStudioOpen } from "../../ui/studio-open";
import { pagePath } from "../constants";
import { pageIdFromField, TALK_OPEN_FIELD_EVENT } from "./talk";

export function TalkBridge() {
  // A global overlay: the page opens in the container the main view shows.
  const open = useStudioOpen("route");
  useEffect(() => {
    const onOpen = (event: Event) => {
      const id = pageIdFromField((event as CustomEvent<{ field?: unknown }>).detail?.field);
      if (!id) return;
      // Tells Talk the page is opening, so it doesn't fall back to copying.
      event.preventDefault();
      open({ href: pagePath(id) });
    };
    window.addEventListener(TALK_OPEN_FIELD_EVENT, onOpen);
    return () => window.removeEventListener(TALK_OPEN_FIELD_EVENT, onOpen);
  }, [open]);
  return null;
}
