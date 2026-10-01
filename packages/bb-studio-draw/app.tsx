// bb-studio-draw — frontend entry.
//
// Surfaces:
//   - navPanel "Drawings": Studio's collection of drawings, and the editor
//     at drawings/<id>. With Studio installed, Studio's page takes over.
//   - threadPanelAction "Drawings": the thread's drawings and recent ones,
//     and the editor, inside a thread's right panel. New makes a drawing
//     linked to the thread; "Attach" adds the rendered drawing to it.
//   - composer `+` menu → "Drawing": pick a drawing (host picker)
//     and upload it as a rendered image attachment for the current conversation.
//   - mention provider (server): `@drawing` works in every composer.
import { toast } from "sonner";
import { errorMessage } from "@bb-studio/kit/format";
import {
  definePluginApp,
  type PluginComposerScope,
} from "@get-bb/plugin-sdk/app";
import { DrawingEditor } from "./components/drawing-editor";
import { DrawingsPanel } from "./components/drawings-panel";
import { ExcalidrawPicker } from "./components/excalidraw-picker";
import { createExcalidrawComposerCustomization } from "./lib/composer-registration";
import { blobToBase64, parseScene, renderSceneToPng } from "./lib/scene";
import { callRpc } from "./lib/rpc";
import { FloatPanels, ThreadItemsPanel } from "@bb-studio/kit/app";
import { DRAW_ICON, PANEL_PATH, PLUGIN_ID, REALTIME_CHANNEL } from "./src/shared";

function DrawingsSurface({ threadId }: { threadId: string }) {
  return (
    <ThreadItemsPanel
      threadId={threadId}
      pluginId={PLUGIN_ID}
      kind="drawing"
      channel={REALTIME_CHANNEL}
      renderItem={(id, { backLabel, onBack }) => <DrawingEditor key={id} drawingId={id} threadId={threadId} backLabel={backLabel} onBack={onBack} />}
    />
  );
}

/** `+` menu flow: pick a drawing, render it to a PNG, and attach it. */
async function attachFromComposer(scope: PluginComposerScope) {
  if (scope.kind !== "thread") return;
  try {
    const { drawingId } = await callRpc("pickDrawing", {
      threadId: scope.threadId,
    });
    if (!drawingId) return; // cancelled
    const { drawing } = await callRpc("getDrawing", { id: drawingId });
    if (!drawing) throw new Error("Drawing not found");
    const blob = await renderSceneToPng(parseScene(drawing.data));
    const pngBase64 = await blobToBase64(blob);
    await callRpc("attachDrawingImage", {
      threadId: scope.threadId,
      drawingId,
      pngBase64,
    });
    toast.success("Drawing PNG attached");
  } catch (error) {
    toast.error(errorMessage(error));
  }
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "drawings",
    title: "Drawings",
    icon: DRAW_ICON,
    path: PANEL_PATH,
    component: ({ subPath }) => <DrawingsPanel subPath={subPath ?? ""} />,
  });

  // Shows the panel in Float windows open on its paths.
  app.slots.experimental_appOverlay({ id: "float", component: () => <FloatPanels path={PANEL_PATH} render={(subPath) => <DrawingsPanel subPath={subPath} />} /> });
  app.slots.threadPanelAction({
    id: "excalidraw",
    title: "Drawings",
    icon: DRAW_ICON,
    layout: "flush",
    run: async ({ openPanel }) => {
      await openPanel({ title: "Drawings" });
    },
    component: ({ threadId }) => <DrawingsSurface threadId={threadId} />,
  });

  app.slots.pendingInteraction({
    id: "excalidraw-picker",
    component: ExcalidrawPicker,
  });

  app.composer.customize(
    createExcalidrawComposerCustomization((scope) => {
      void attachFromComposer(scope);
    }),
  );
});
