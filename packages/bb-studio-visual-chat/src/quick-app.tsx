// The quick card: a floating Visual Chat for quick questions, summoned from
// anywhere in BB with "Visual Chat: Ask" (Mod+Shift+Space by default; BB
// keeps Mod+K for thread search and Studio Mod+Shift+K for its search). The
// same command closes it. While it's closed the overlay renders nothing and
// the page bundle isn't loaded, so it takes no focus and no keys.
import { lazy, Suspense, useSyncExternalStore } from "react";
import type { PluginAppBuilder, PluginCommandShortcut } from "@get-bb/plugin-sdk/app";
import { createQuickStore, type QuickStore } from "./ui/quick-store";

export const QUICK_COMMAND_ID = "ask";
export const QUICK_COMMAND_TITLE = "Visual Chat: Ask";
export const QUICK_SHORTCUT: PluginCommandShortcut = { key: "Space", mod: true, shift: true };

const QuickCard = lazy(() => import("../bundle/canvas-ui.js").then((module) => ({ default: module.QuickCard })));

export function registerQuickCard(app: Pick<PluginAppBuilder, "slots" | "commands">, store: QuickStore = createQuickStore()): QuickStore {
  function QuickOverlay() {
    const state = useSyncExternalStore(store.subscribe, store.get, store.get);
    if (!state.open) return null;
    return <Suspense fallback={null}><QuickCard key={state.session} store={store} threadId={state.threadId} /></Suspense>;
  }
  app.slots.experimental_appOverlay({ id: "quick-card", component: QuickOverlay });
  app.commands.register({ id: QUICK_COMMAND_ID, title: QUICK_COMMAND_TITLE, defaultShortcut: QUICK_SHORTCUT, run: () => store.toggle() });
  return store;
}
