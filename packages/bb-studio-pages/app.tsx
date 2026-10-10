import { RetainedPanels, retainPanel, StudioBarSlot, openAppPath } from "@bb-studio/kit/app";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { useEffect } from "react";
import { PAGE_TAB, PageCard } from "./src/ui/PageCard";
import { PagePanel } from "./src/ui/PagePanel";
import { PagesPanel } from "./src/ui/PagesPanel";
import { ThreadPageLink } from "./src/ui/ThreadPageLink";
import { pageIdFromField, TALK_OPEN_FIELD_EVENT } from "./src/ui/talk";
import { registerExploreApp } from "./src/explore/app";
import "./styles.css";

/** Opens a page when Talk's "Go back" asks for a dictation field of ours. */
function TalkBridge() {
  useEffect(() => {
    const onOpen = (event: Event) => {
      const id = pageIdFromField((event as CustomEvent<{ field?: unknown }>).detail?.field);
      if (!id) return;
      // Tells Talk the page is opening, so it doesn't fall back to copying.
      event.preventDefault();
      openAppPath(`/plugins/pages/pages/${encodeURIComponent(id)}`);
    };
    window.addEventListener(TALK_OPEN_FIELD_EVENT, onOpen);
    return () => window.removeEventListener(TALK_OPEN_FIELD_EVENT, onOpen);
  }, []);
  return null;
}

export default definePluginApp((app) => {
  // Explore: "Along the way" findings and their explainer pages.
  registerExploreApp(app);
  // Keeps the panel's views alive across route changes (with retainPanel).
  app.slots.experimental_appOverlay({ id: "retained", component: () => <RetainedPanels path="pages" render={(subPath) => <PagesPanel subPath={subPath} />} /> });
  app.slots.navPanel({ id: "pages", title: "Pages", icon: "pages/pages", path: "pages", component: retainPanel("pages", PagesPanel), headerContent: StudioBarSlot });
  app.slots.experimental_appOverlay({ id: "talk-bridge", component: TalkBridge });
  app.slots.experimental_threadHeaderAction({ id: "page-link", title: "Page", component: ThreadPageLink });
  // Pages next to a thread: its pages and recent ones, or a page with `{ pageId }`.
  app.slots.threadPanelAction({ id: PAGE_TAB, title: "Pages", icon: "pages/pages", layout: "flush", component: PagePanel });
  // `::page{id="pg_…"}` in a reply: a card that opens the page beside the chat.
  app.slots.messageDirective({ id: "page", component: PageCard });
});
