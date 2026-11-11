import type { PluginCloseFallbackSlot } from "./fork-slots";
import { sidePanelOf } from "./fork-item-drag";
import { getPluginSlotSnapshot } from "./plugin-slots";
import { setForkCloseGuard } from "./bb-desktop.fork";

export interface ClosePanelState {
  focusInPanel: boolean;
  hasClosableSelectedTab: boolean;
}

export function readClosePanelState(doc: Document): ClosePanelState {
  const active = doc.activeElement;
  const panel = active === null ? null : sidePanelOf(active);
  if (panel === null || panel.getAttribute("aria-hidden") === "true") {
    return { focusInPanel: false, hasClosableSelectedTab: false };
  }
  const hasClosableSelectedTab = Array.from(
    panel.querySelectorAll("[data-tab-pill]"),
  ).some(
    (pill) =>
      pill.querySelector(':scope > button[aria-pressed="true"]') !== null &&
      pill.querySelector("[data-tab-pill-close]") !== null,
  );
  return { focusInPanel: true, hasClosableSelectedTab };
}

export function closeFallbackApplies(state: ClosePanelState): boolean {
  return !state.focusInPanel || !state.hasClosableSelectedTab;
}

export function runCloseFallbacks(
  handlers: readonly PluginCloseFallbackSlot[],
): boolean {
  const ordered = [...handlers].sort(
    (a, b) => a.pluginId.localeCompare(b.pluginId) || a.id.localeCompare(b.id),
  );
  for (const handler of ordered) {
    try {
      if (handler.close() === true) return true;
    } catch (error) {
      console.warn(
        `[plugin:${handler.pluginId}] close fallback "${handler.id}" failed`,
        error,
      );
    }
  }
  return false;
}

let answer: boolean | null = null;

export function closeFallbackHandled(): boolean {
  if (answer !== null) return answer;
  const handled =
    closeFallbackApplies(readClosePanelState(document)) &&
    runCloseFallbacks(getPluginSlotSnapshot().closeFallbacks);
  answer = handled;
  queueMicrotask(() => {
    answer = null;
  });
  return handled;
}

setForkCloseGuard(closeFallbackHandled);
