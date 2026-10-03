import { FloatPanels, retainPanel } from "@bb-studio/kit/app";
import { definePluginApp, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useEffect } from "react";
import { PagePanel } from "./src/ui/PagePanel";
import { PagesPanel } from "./src/ui/PagesPanel";
import { ThreadPageLink } from "./src/ui/ThreadPageLink";
import { pageIdFromField, TALK_OPEN_FIELD_EVENT } from "./src/ui/talk";
import "./styles.css";

/** Opens a page when Talk's "Go back" asks for a dictation field of ours. */
function TalkBridge() {
  const navigate = useBbNavigate();
  useEffect(() => {
    const onOpen = (event: Event) => {
      const id = pageIdFromField((event as CustomEvent<{ field?: unknown }>).detail?.field);
      if (!id) return;
      // Tells Talk the page is opening, so it doesn't fall back to copying.
      event.preventDefault();
      navigate.toPluginPanel("pages", { subPath: id });
    };
    window.addEventListener(TALK_OPEN_FIELD_EVENT, onOpen);
    return () => window.removeEventListener(TALK_OPEN_FIELD_EVENT, onOpen);
  }, [navigate]);
  return null;
}

export default definePluginApp((app) => {
  // Shows the panel in Float windows open on its paths.
  app.slots.experimental_appOverlay({ id: "float", component: () => <FloatPanels path="pages" render={(subPath) => <PagesPanel subPath={subPath} />} /> });
  app.slots.navPanel({ id: "pages", title: "Pages", icon: "pages/pages", path: "pages", component: retainPanel("pages", PagesPanel) });
  app.slots.experimental_appOverlay({ id: "talk-bridge", component: TalkBridge });
  app.slots.experimental_threadHeaderAction({ id: "page-link", title: "Page", component: ThreadPageLink });
  // Pages next to a thread: its pages and recent ones, or a page with `{ pageId }`.
  app.slots.threadPanelAction({ id: "page", title: "Pages", icon: "pages/pages", layout: "flush", component: PagePanel });
});
