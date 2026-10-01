// bb-studio-float frontend: the panel of floated tabs, and commands to float
// what's on screen and to put the panel away.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { floatPanelFor } from "@bb-studio/kit/app";
import { Dock } from "./src/Dock";
import { update } from "./src/store";
import { openTab, toggleHidden } from "./src/stack";

/** The view on screen as a tab: another plugin's panel, else the thread. */
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
      if (target) update((state) => openTab(state, target));
    },
  });
  app.commands.register({
    id: "toggle",
    title: "Float: show or hide the floating tabs",
    defaultShortcut: { key: "j", mod: true, shift: true },
    run: () => update(toggleHidden),
  });
});
