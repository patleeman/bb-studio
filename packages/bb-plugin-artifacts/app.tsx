// Studio Artifacts — frontend entry.
//
// Surfaces:
//   - navPanel "Artifacts": Studio's collection of artifacts, and the viewer
//     at artifacts/<id>. With Studio installed, Studio's page takes over.
//   - messageAction "Save to Studio": opens the picker below for that reply.
//   - threadPanelAction "Save to Studio": the files a reply made and the
//     thread's storage files, to save; and what the thread already saved.
//   - messageDirective `::artifact{id="art_…"}`: a card in a reply.
//   - mention provider (server): `@artifact` works in every composer.
import { toast } from "sonner";
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { ArtifactCard } from "./components/artifact-card";
import { ArtifactsPanel } from "./components/artifacts-panel";
import { SavePicker } from "./components/save-picker";
import { ARTIFACT_ICON, PANEL_PATH, SAVE_ICON } from "./src/shared";

const PICKER = "save-to-studio";

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "artifacts",
    title: "Artifacts",
    icon: ARTIFACT_ICON,
    path: PANEL_PATH,
    component: ({ subPath }) => <ArtifactsPanel subPath={subPath ?? ""} />,
  });

  app.slots.threadPanelAction({
    id: PICKER,
    title: "Save to Studio",
    icon: SAVE_ICON,
    layout: "flush",
    component: SavePicker,
  });

  app.slots.messageAction({
    id: "save-to-studio",
    title: "Save to Studio",
    icon: SAVE_ICON,
    run: ({ message, openPanel }) => {
      const opened = openPanel({ actionId: PICKER, title: "Save to Studio", params: { seq: message.sourceSeqEnd } });
      if (!opened) toast.error("Open this thread on its own to save its files.");
    },
  });

  app.slots.messageDirective({ id: "artifact", component: ArtifactCard });
});
