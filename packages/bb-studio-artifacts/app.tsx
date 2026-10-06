// Studio Artifacts — frontend entry.
//
// Surfaces:
//   - navPanel "Artifacts": Studio's collection of artifacts, and the viewer
//     at artifacts/<id>. With Studio installed, Studio's page takes over.
//   - threadPanelAction "Artifacts": the files a reply made and the
//     thread's storage files, to save; and what the thread already saved.
//     Opened with `{ artifactId }`, it shows that artifact.
//   - messageDirective `::artifact{id="art_…"}`: a card in a reply that opens
//     the artifact in the workbench.
//   - mention provider (server): `@artifact` works in every composer.
import { RetainedPanels, retainPanel, StudioBarSlot } from "@bb-studio/kit/app";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { ArtifactCard } from "./components/artifact-card";
import { ArtifactsPanel } from "./components/artifacts-panel";
import { SavePicker } from "./components/save-picker";
import { ARTIFACT_ICON, ARTIFACTS_TAB, PANEL_PATH, SAVE_ICON } from "./src/shared";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "artifacts",
    title: "Artifacts",
    icon: ARTIFACT_ICON,
    path: PANEL_PATH,
    component: retainPanel(PANEL_PATH, ArtifactsPanel),
    headerContent: StudioBarSlot,
  });

  // Keeps the panel's views alive across route changes (with retainPanel).
  app.slots.experimental_appOverlay({ id: "retained", component: () => <RetainedPanels path={PANEL_PATH} render={(subPath) => <ArtifactsPanel subPath={subPath} />} /> });
  app.slots.threadPanelAction({
    id: ARTIFACTS_TAB,
    title: "Artifacts",
    icon: SAVE_ICON,
    layout: "flush",
    component: SavePicker,
  });

  app.slots.messageDirective({ id: "artifact", component: ArtifactCard });
});
