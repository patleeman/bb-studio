import { moduleApp } from "../../app";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { Navigation } from "./app/Navigation.js";

function registerNavigation(app: import("@get-bb/plugin-sdk/app").PluginAppBuilder) {
  app.slots.experimental_sidebarNavigation({
    id: "navigation",
    title: "Studio Navigation",
    description:
      "bb's navigation rows, without the Studio panels that Studio and Studio Sidebar already open.",
    component: Navigation,
  });
}
export function registerApp(host: import("@get-bb/plugin-sdk/app").PluginAppBuilder) { registerNavigation(moduleApp(host, "navigation")); }
export default definePluginApp(registerNavigation);
