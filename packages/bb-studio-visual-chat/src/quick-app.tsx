// The quick card: a floating Visual Chat for quick questions, summoned from
// anywhere in BB with "Visual Chat: Ask": Control+Shift+Space by default
// (Ctrl+Shift+Space everywhere). No BB or Studio default uses it, and it
// stays clear of common macOS ones: ⌘Space (Spotlight, Raycast), ⌥Space (the
// ChatGPT and Claude apps), ⌘⇧Space (1Password's Quick Access). No Option:
// on a Mac, Option+Space can type a non-breaking space, which BB's shortcut
// matching doesn't read as Space.
// The same command closes it. While it's closed the overlay renders nothing
// and the page bundle isn't loaded, so it takes no focus and no keys.
import { lazy, Suspense, useSyncExternalStore } from "react";
import type { PluginAppBuilder, PluginCommandShortcut } from "@get-bb/plugin-sdk/app";
import { createQuickStore, type QuickStore } from "./ui/quick-store";

export const QUICK_COMMAND_ID = "ask";
export const QUICK_COMMAND_TITLE = "Visual Chat: Ask";
export const QUICK_SHORTCUT: PluginCommandShortcut = { key: "Space", control: true, shift: true };

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
