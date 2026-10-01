import { FloatPanels } from "@bb-studio/kit/app";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { TablesPanel, ThreadTablesPanel } from "./src/panel";
export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "tables",
    title: "Tables",
    icon: "Rows2",
    path: "tables",
    component: ({ subPath }) => <TablesPanel subPath={subPath ?? ""} />,
  });
  // Shows the panel in Float windows open on its paths.
  app.slots.experimental_appOverlay({ id: "float", component: () => <FloatPanels path="tables" render={(subPath) => <TablesPanel subPath={subPath} />} /> });
  app.slots.threadPanelAction({
    id: "tables",
    title: "Tables",
    icon: "Rows2",
    layout: "flush",
    component: ({ threadId }) => <ThreadTablesPanel threadId={threadId} />,
  });
});
