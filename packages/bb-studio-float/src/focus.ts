import type { BbNavigate } from "@get-bb/plugin-sdk";
import { getFloat, update } from "./store";
import { selectTab } from "./stack";

export function focusCompanion(key: string, navigate: Pick<BbNavigate, "toPluginPanel">): void {
  const tab = getFloat().tabs.find(candidate => candidate.key === key);
  if (!tab) return;
  update(state => selectTab(state, key));
  if (tab.placement === "main") navigate.toPluginPanel("companions", { subPath: key });
}
