// bb-studio-draw — frontend entry.
//
// Surfaces:
//   - navPanel "Drawings": Studio's collection of drawings, and the editor
//     at drawings/<id>. With Studio installed, Studio's page takes over.
//   - threadPanelAction "Drawings": the workbench tab beside a conversation,
//     showing one drawing's editor or the thread's drawings and recent ones.
//     New makes a drawing linked to the thread; "Attach" adds the rendered
//     drawing to it.
//   - messageDirective `::drawing{id="…"}`: a card in a reply that opens the
//     drawing in the workbench.
//   - composer `+` menu → "Drawing": pick a drawing (host picker)
//     and upload it as a rendered image attachment for the current conversation.
//   - mention provider (server): `@drawing` works in every composer.
import { toast } from "sonner";
import { errorMessage } from "@bb-studio/kit/format";
import {
  definePluginApp,
  type PluginComposerScope,
} from "@get-bb/plugin-sdk/app";
import { DRAWINGS_TAB, DrawingDirective, DrawingsTab } from "./components/drawing-tab";
import { DrawingsPanel } from "./components/drawings-panel";
import { ExcalidrawPicker } from "./components/excalidraw-picker";
import { createExcalidrawComposerCustomization } from "./lib/composer-registration";
import { blobToBase64, parseScene, renderSceneToPng } from "./lib/scene";
import { callRpc } from "./lib/rpc";
import { RetainedPanels, retainPanel, StudioBarSlot } from "@bb-studio/kit/app";
import { DRAW_ICON, PANEL_PATH } from "./src/shared";

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
    component: retainPanel(PANEL_PATH, DrawingsPanel),
    headerContent: StudioBarSlot,
  });

  // Keeps the panel's views alive across route changes (with retainPanel).
  app.slots.experimental_appOverlay({ id: "retained", component: () => <RetainedPanels path={PANEL_PATH} render={(subPath) => <DrawingsPanel subPath={subPath} />} /> });
  app.slots.threadPanelAction({
    id: DRAWINGS_TAB,
    title: "Drawings",
    icon: DRAW_ICON,
    layout: "flush",
    run: async ({ openPanel }) => {
      await openPanel({ title: "Drawings" });
    },
    component: DrawingsTab,
  });

  app.slots.messageDirective({ id: "drawing", component: DrawingDirective });

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
