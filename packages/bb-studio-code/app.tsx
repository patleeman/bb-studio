// bb-studio-code — frontend entry.
//
// Surfaces:
//   - navPanel "Workspaces": Studio's collection of VS Code workspaces, and
//     the editor at workspaces/<id>. With Studio installed, Studio's page
//     takes over the collection.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { RetainedPanels, retainPanel, StudioBarSlot } from "@bb-studio/kit/app";
import { CodePanel } from "./src/panel";
import { CODE_ICON, PANEL_PATH } from "./src/shared";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "workspaces",
    title: "Workspaces",
    icon: CODE_ICON,
    path: PANEL_PATH,
    component: retainPanel(PANEL_PATH, CodePanel),
    headerContent: StudioBarSlot,
  });
  // Keeps open editors alive across route changes (with retainPanel), so
  // VS Code doesn't reload every time the user looks at something else.
  app.slots.experimental_appOverlay({ id: "retained", component: () => <RetainedPanels path={PANEL_PATH} render={(subPath) => <CodePanel subPath={subPath} />} /> });
});
