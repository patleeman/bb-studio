import type { PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { ChannelAutomations } from "./channel-automations";
import type { rpcContract } from "./contract";

type AutomationMethod = "automationCreate" | "automationList" | "automationUpdate" | "automationAction" | "automationRuns";

export function automationHandlers(automations: ChannelAutomations): Pick<PluginRpcHandlers<typeof rpcContract>, AutomationMethod> {
  return {
    automationCreate: (input) => automations.create(input),
    automationList: (input) => automations.list(input),
    automationUpdate: (input) => automations.update(input),
    automationAction: (input) => automations.action(input),
    automationRuns: (input) => automations.runs(input),
  };
}
