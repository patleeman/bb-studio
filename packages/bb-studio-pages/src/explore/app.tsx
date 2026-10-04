import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { FloatPanels, retainPanel, openCompanion } from "@bb-studio/kit/app";
import { DIRECTIVE, PANEL_ACTION } from "./src/shared";
import { EXPLAINERS_PATH, EXPLORE_ICON, threadExplainersPath } from "./src/ui/explore";
import { ExplainersPage, ExplainerTab } from "./src/ui/panel";
import { ExploreDirective } from "./src/ui/rows";
import { ExploreGate } from "./client";

export function registerExploreApp(app: PluginAppBuilder) {
  // "Along the way" findings at the end of a reply.
  app.slots.messageDirective({ id: DIRECTIVE, component: props => <ExploreGate><ExploreDirective {...props} /></ExploreGate> });
  // An explainer next to its thread, opened with `{ explainerId }`.
  app.slots.threadPanelAction({ id: PANEL_ACTION, title: "Explore", icon: EXPLORE_ICON, layout: "flush",
    component: props => <ExploreGate><ExplainerTab {...props} /></ExploreGate>,
    run: ({ threadId, openPanel }) => {
      if (!openCompanion({ kind: "path", path: threadExplainersPath(threadId), title: "Explore" })) openPanel();
    },
  });
  const Page = (props: { subPath: string }) => <ExploreGate notice><ExplainersPage {...props} /></ExploreGate>;
  app.slots.navPanel({ id: EXPLAINERS_PATH, path: EXPLAINERS_PATH, title: "Explore", icon: EXPLORE_ICON, component: retainPanel(EXPLAINERS_PATH, Page) });
  app.slots.experimental_appOverlay({ id: "explainer-companions", component: () => <ExploreGate><FloatPanels path={EXPLAINERS_PATH} render={subPath => <ExplainersPage subPath={subPath} />} /></ExploreGate> });
}
