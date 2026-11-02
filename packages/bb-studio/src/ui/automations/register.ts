// Registers the thread panel's "Automations" tab, and the header clock badge
// only where the host offers `experimental_threadHeaderAction`.
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { AUTOMATIONS_TAB } from "./model";
import { ThreadAutomationsBadge, ThreadAutomationsPanel } from "./ThreadAutomations";

export function registerThreadAutomations(app: PluginAppBuilder): void {
  app.slots.threadPanelAction({
    id: AUTOMATIONS_TAB,
    title: "Automations",
    icon: "Clock",
    component: ThreadAutomationsPanel,
  });
  const slots = app.slots as Partial<typeof app.slots>;
  if (typeof slots.experimental_threadHeaderAction !== "function") return;
  try {
    slots.experimental_threadHeaderAction({ id: "thread-automations-badge", title: "Automations", component: ThreadAutomationsBadge });
  } catch {
    // An older or newer host may refuse the slot; the tab still works.
  }
}
