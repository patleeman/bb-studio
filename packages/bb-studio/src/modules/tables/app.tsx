import { moduleComponent } from "../Notice";
import { FloatPanels, retainPanel } from "@bb-studio/kit/app";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { TablesPanel, ThreadTablesPanel } from "./src/panel";
export function registerApp(host: import("@get-bb/plugin-sdk/app").PluginAppBuilder) {
  const app = { ...host, slots: new Proxy(host.slots, { get(target, property) {
    const register = Reflect.get(target, property);
    if (typeof register !== "function") return register;
    return (registration: { component?: import("react").ComponentType<object> }) => register.call(target, registration.component ? { ...registration, component: moduleComponent("tables", registration.component) } : registration);
  } }) };
  app.slots.navPanel({
    id: "tables",
    title: "Tables",
    icon: "Rows2",
    path: "tables",
    component: retainPanel("tables", TablesPanel),
  });
  // Shows the panel in Float windows open on its paths.
  app.slots.experimental_appOverlay({ id: "tables-float", component: () => <FloatPanels path="tables" render={(subPath) => <TablesPanel subPath={subPath} />} /> });
  app.slots.threadPanelAction({
    id: "tables",
    title: "Tables",
    icon: "Rows2",
    layout: "flush",
    component: ({ threadId }) => <ThreadTablesPanel threadId={threadId} />,
  });
}

export default definePluginApp(registerApp);
