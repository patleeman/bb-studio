// The Strands page was a workbench tab of its own (Studio's tab id "loops"),
// and a memory record opened as a tab too ("memory-record"). Both are gone
// and nothing draws those tabs, so Studio closes any still open, like the fixed Bot tabs (retire-fixed-tabs.tsx). BB lists only the
// workbench on screen, so this checks at start and again a little after the
// view changes (another conversation, a window coming back). An app overlay
// that draws nothing.
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useEffect } from "react";
import { workbenchOf } from "../../kit/app/host-sdk";
import { STUDIO_PLUGIN_ID } from "../../kit/contract";
import type { PanelTab } from "../../workbench-agent/exec";

/** The old Strands page's tab id. */
export const RETIRED_STRANDS_TAB = "loops";
/** Every retired tab id: the Strands page and the memory record tab (memory records are retired). */
export const RETIRED_TABS: ReadonlySet<string> = new Set([RETIRED_STRANDS_TAB, "memory-record"]);
const SETTLE_MS = 400;
const AGAIN_ON = ["focus", "popstate", "pointerup"] as const;

/** The keys of Studio's retired tabs (Strands, memory records) among `tabs`. Pure. */
export function strandsTabsToClose(tabs: readonly PanelTab[], pluginId: string = STUDIO_PLUGIN_ID): string[] {
  return tabs.filter((tab) => tab.detail.kind === "plugin" && "pluginId" in tab.detail && tab.detail.pluginId === pluginId && RETIRED_TABS.has(tab.detail.tab.id)).map((tab) => tab.key);
}

/** Closes the Strands page tabs in the workbench on screen; how many it closed. */
export function closeStrandsTabs(navigate: object): number {
  const workbench = workbenchOf(navigate);
  if (!workbench) return 0;
  try {
    return strandsTabsToClose(workbench.list().tabs).filter((key) => workbench.close(key)).length;
  } catch {
    return 0;
  }
}

export function retireStrandsTabs(navigate: object, view: Pick<Window, "addEventListener" | "removeEventListener" | "setTimeout" | "clearTimeout">): () => void {
  let timer: ReturnType<Window["setTimeout"]> | null = null;
  const soon = () => {
    if (timer !== null) view.clearTimeout(timer);
    timer = view.setTimeout(() => { timer = null; closeStrandsTabs(navigate); }, SETTLE_MS);
  };
  closeStrandsTabs(navigate);
  soon();
  for (const name of AGAIN_ON) view.addEventListener(name, soon, true);
  return () => {
    if (timer !== null) view.clearTimeout(timer);
    for (const name of AGAIN_ON) view.removeEventListener(name, soon, true);
  };
}

export function RetireStrandsTabs() {
  const navigate = useBbNavigate();
  useEffect(() => retireStrandsTabs(navigate, window), [navigate]);
  return null;
}
