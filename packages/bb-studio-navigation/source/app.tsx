import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { Navigation } from "./app/Navigation.js";

export default definePluginApp((app) => {
  app.slots.experimental_sidebarNavigation({
    id: "navigation",
    title: "Studio Navigation",
    description:
      "bb's navigation rows, without the Studio panels that Studio and Studio Sidebar already open.",
    component: Navigation,
  });
});
