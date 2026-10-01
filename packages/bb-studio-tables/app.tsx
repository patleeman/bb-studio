import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { TablesPanel } from "./src/panel";
export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "tables",
    title: "Tables",
    icon: "Rows2",
    path: "tables",
    component: ({ subPath }) => <TablesPanel subPath={subPath ?? ""} />,
  });
});
