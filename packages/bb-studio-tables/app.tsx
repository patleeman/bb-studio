import { RetainedPanels, retainPanel, StudioBarSlot } from "@bb-studio/kit/app";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { TablesPanel, ThreadTablesPanel } from "./src/panel";
export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "tables",
    title: "Tables",
    icon: "Rows2",
    path: "tables",
    component: retainPanel("tables", TablesPanel),
    headerContent: StudioBarSlot,
  });
  // Keeps the panel's views alive across route changes (with retainPanel).
  app.slots.experimental_appOverlay({ id: "retained", component: () => <RetainedPanels path="tables" render={(subPath) => <TablesPanel subPath={subPath} />} /> });
  app.slots.threadPanelAction({
    id: "tables",
    title: "Tables",
    icon: "Rows2",
    layout: "flush",
    component: ({ threadId }) => <ThreadTablesPanel threadId={threadId} />,
  });
});
