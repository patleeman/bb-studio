// Code is a tool with its own page, not Studio content. The kit's
// RetainedPanels (which keeps VS Code alive across route changes) also
// registers the panel with Studio's workspace, which would then open every
// /plugins/studio-code/workspaces/<id> link as a Studio tab. This takes Code
// back out of that shared registry, so its links open Code's own page.
import { PANEL_PATH, PLUGIN_ID } from "./shared";

/** The kit's shared workspace bridge (src/app/workspace.ts in @bb-studio/kit). */
const BRIDGE_KEY = "__bbStudioWorkspace_v1";
const BRIDGE_EVENT = "bb-studio-workspace-change";
export const CODE_ROOT = `/plugins/${PLUGIN_ID}/${PANEL_PATH}`;

/** Removes Code's panel from Studio's workspace providers; true when it was there. */
export function leaveStudioWorkspace(scope: Record<string, unknown> = window as unknown as Record<string, unknown>): boolean {
  const bridge = scope[BRIDGE_KEY] as { revision?: number; providers?: Map<string, symbol> } | undefined;
  if (!bridge?.providers?.delete(CODE_ROOT)) return false;
  bridge.revision = (bridge.revision ?? 0) + 1;
  if (typeof scope.dispatchEvent === "function") (scope as unknown as EventTarget).dispatchEvent(new Event(BRIDGE_EVENT));
  return true;
}
