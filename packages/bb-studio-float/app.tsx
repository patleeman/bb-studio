// bb-studio-float frontend: the windows along the bottom of the screen, and
// commands to float what's on screen and to put the windows away.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { floatPanelFor } from "@bb-studio/kit/app";
import { Dock } from "./src/Dock";
import { update } from "./src/store";
import { openWindow, toggleHidden } from "./src/windows";

/** The view on screen as a window: another plugin's panel, else the thread. */
function currentTarget(threadId: string | null) {
  const path = window.location.pathname;
  if (floatPanelFor(path)) return { kind: "path" as const, path };
  return threadId ? { kind: "thread" as const, threadId } : null;
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "dock", component: Dock });
  app.commands.register({
    id: "float-view",
    title: "Float: float this view",
    isAvailable: ({ threadId }) => currentTarget(threadId) !== null,
    run: ({ threadId }) => {
      const target = currentTarget(threadId);
      if (target) update((state) => openWindow(state, target));
    },
  });
  app.commands.register({
    id: "toggle",
    title: "Float: show or hide windows",
    defaultShortcut: { key: "j", mod: true, shift: true },
    run: () => update(toggleHidden),
  });
});
