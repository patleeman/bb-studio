// bb-plugin-excalidraw — frontend entry.
//
// Surfaces:
//   - navPanel "Drawings": Studio's collection of drawings, and the editor
//     at drawings/<id>. With Studio installed, Studio's page takes over.
//   - threadPanelAction "Drawings": a gallery and editor inside a thread's
//     right panel, where "Attach" adds the rendered drawing to that
//     conversation.
//   - composer `+` menu → "Drawing": pick a drawing (host picker)
//     and upload it as a rendered image attachment for the current conversation.
//   - mention provider (server): `@drawing` works in every composer.
import { useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@bb-studio/kit/format";
import {
  definePluginApp,
  type PluginComposerScope,
} from "@get-bb/plugin-sdk/app";
import { DrawingGallery } from "./components/drawing-gallery";
import { DrawingEditor } from "./components/drawing-editor";
import { DrawingsPanel } from "./components/drawings-panel";
import { ExcalidrawPicker } from "./components/excalidraw-picker";
import { createExcalidrawComposerCustomization } from "./lib/composer-registration";
import { blobToBase64, parseScene, renderSceneToPng } from "./lib/scene";
import { callRpc } from "./lib/rpc";
import { DRAW_ICON, PANEL_PATH } from "./src/shared";

function DrawingsSurface({ threadId }: { threadId: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (openId) {
    return (
      <DrawingEditor
        drawingId={openId}
        threadId={threadId}
        backLabel="Drawings"
        onBack={() => setOpenId(null)}
      />
    );
  }
  return <DrawingGallery threadId={threadId} onOpen={setOpenId} />;
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
