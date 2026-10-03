import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { FloatPanels } from "@bb-studio/kit/app";
import { DIRECTIVE, PANEL_ACTION } from "./src/shared";
import { EXPLAINERS_PATH, EXPLORE_ICON } from "./src/ui/explore";
import { ExplainersPage, ExplainerTab } from "./src/ui/panel";
import { ExploreDirective } from "./src/ui/rows";

export default definePluginApp((app) => {
  // "Along the way" findings at the end of a reply.
  app.slots.messageDirective({ id: DIRECTIVE, component: ExploreDirective });
  // An explainer next to its thread, opened with `{ explainerId }`.
  app.slots.threadPanelAction({ id: PANEL_ACTION, title: "Explore", icon: EXPLORE_ICON, layout: "flush", component: ExplainerTab });
  app.slots.navPanel({ id: EXPLAINERS_PATH, path: EXPLAINERS_PATH, title: "Explore", icon: EXPLORE_ICON, component: ExplainersPage });
  app.slots.experimental_appOverlay({ id: "explainer-companions", component: () => <FloatPanels path={EXPLAINERS_PATH} render={subPath => <ExplainersPage subPath={subPath} />} /> });
});
