// What BB's main window does for a path a plugin window sends it
// (`window.openInMain`) instead of opening it: an action that needs the main
// window's own state, such as VS Code for the thread in view. The code that
// owns the action registers it; the main window's bridge
// (src/windows/ui/WindowsBridge.tsx) looks it up.
const actions = new Map<string, () => void | Promise<void>>();

export function onMainWindowPath(path: string, run: () => void | Promise<void>): void {
  actions.set(path, run);
}

/** The action registered for `path`, or null to open the path. */
export function mainWindowAction(path: string): (() => void | Promise<void>) | null {
  return actions.get(path) ?? null;
}
