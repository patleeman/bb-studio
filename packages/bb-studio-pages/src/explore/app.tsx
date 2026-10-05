import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { FloatPanels, retainPanel, openCompanion } from "@bb-studio/kit/app";
import { DIRECTIVE, PANEL_ACTION } from "./src/shared";
import { EXPLAINERS_PATH, EXPLORE_ICON, threadExplainersPath } from "./src/ui/explore";
import { ExplainersPage, ExplainerTab } from "./src/ui/panel";
import { ExploreDirective } from "./src/ui/rows";
import { ComposerBridge } from "@bb-studio/kit/composer";
import { NextDirective } from "./src/ui/next";
import { NEXT_DIRECTIVE } from "./src/next";

export function registerExploreApp(app: PluginAppBuilder) {
  // "Along the way" findings at the end of a reply.
  app.slots.messageDirective({ id: DIRECTIVE, component: ExploreDirective });
  // The Next row: replies, things to explore and actions in one line at the end of a reply.
  app.slots.messageDirective({ id: NEXT_DIRECTIVE, component: NextDirective });
  // Lets the Next row draft into the composer of the message's thread. Renders nothing.
  app.composer.customize({ id: "next-composer", banners: [{ id: "composer-bridge", chrome: "bare", component: ComposerBridge }] });
  // An explainer next to its thread, opened with `{ explainerId }`.
  app.slots.threadPanelAction({ id: PANEL_ACTION, title: "Explore", icon: EXPLORE_ICON, layout: "flush",
    component: ExplainerTab,
    run: ({ threadId, openPanel }) => {
      if (!openCompanion({ kind: "path", path: threadExplainersPath(threadId), title: "Explore" })) openPanel();
    },
  });
  app.slots.navPanel({ id: EXPLAINERS_PATH, path: EXPLAINERS_PATH, title: "Explore", icon: EXPLORE_ICON, component: retainPanel(EXPLAINERS_PATH, ExplainersPage) });
  app.slots.experimental_appOverlay({ id: "explainer-companions", component: () => <FloatPanels path={EXPLAINERS_PATH} render={subPath => <ExplainersPage subPath={subPath} />} /> });
}
