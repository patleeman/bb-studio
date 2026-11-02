// Registers the thread panel's "Automations" tab.
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { registerThreadTab } from "../../kit/app/thread-panel";
import { AUTOMATIONS_TAB } from "./model";
import { ThreadAutomationsPanel } from "./ThreadAutomations";

export function registerThreadAutomations(app: PluginAppBuilder): void {
  registerThreadTab(app, {
    id: AUTOMATIONS_TAB,
    title: "Automations",
    icon: "Clock",
    component: ThreadAutomationsPanel,
  });
}
