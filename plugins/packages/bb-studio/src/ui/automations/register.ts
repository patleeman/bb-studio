// Registers the thread panel's "Scheduled" tab.
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { OFF_NEW_TAB, registerThreadTab } from "../../kit/app/thread-panel";
import { AUTOMATIONS_TAB } from "./model";
import { ThreadAutomationsPanel } from "./ThreadAutomations";

export function registerThreadAutomations(app: PluginAppBuilder): void {
  registerThreadTab(app, {
    id: AUTOMATIONS_TAB,
    title: "Scheduled",
    icon: "Clock",
    component: ThreadAutomationsPanel,
    ...OFF_NEW_TAB,
  });
}
