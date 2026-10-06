// bb-studio-design — frontend entry.
//
// Surfaces:
//   - navPanel "Designs": Studio's collection of designs, and the canvas at
//     designs/<id>. With Studio installed, Studio's page takes over.
//   - threadPanelAction "Design": the workbench tab beside a conversation,
//     showing one design's canvas or the thread's designs.
//   - messageDirective `::design{id="dsn_…"}`: a card in a reply that opens
//     the design in the workbench.
//   - mention provider (server): `@design` works in every composer.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { RetainedPanels, retainPanel, StudioBarSlot } from "@bb-studio/kit/app";
import { DESIGN_TAB, DesignCard, DesignTab } from "./components/design-tab";
import { DesignsPanel } from "./components/designs-panel";
import { DESIGN_ICON, PANEL_PATH } from "./src/shared";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "designs",
    title: "Designs",
    icon: DESIGN_ICON,
    path: PANEL_PATH,
    component: retainPanel(PANEL_PATH, DesignsPanel),
    headerContent: StudioBarSlot,
  });

  app.slots.threadPanelAction({
    id: DESIGN_TAB,
    title: "Design",
    icon: DESIGN_ICON,
    layout: "flush",
    run: ({ openPanel }) => {
      openPanel({ title: "Design" });
    },
    component: DesignTab,
  });

  app.slots.messageDirective({ id: "design", component: DesignCard });

  // Keeps the panel's views alive across route changes (with retainPanel).
  app.slots.experimental_appOverlay({ id: "retained", component: () => <RetainedPanels path={PANEL_PATH} render={(subPath) => <DesignsPanel subPath={subPath} />} /> });
});
