// The composer `+` menu → "Drawing": pick a drawing in the host-rendered
// picker, render it to a PNG, and attach it to the conversation. Excalidraw
// renders the PNG, so it loads only once a drawing is picked.
import type { PluginComposerScope } from "@get-bb/plugin-sdk/app";
import { errorMessage } from "../../kit/format";
import { toast } from "sonner";
import { callRpc } from "./rpc";

export async function attachFromComposer(scope: PluginComposerScope) {
  if (scope.kind !== "thread") return;
  try {
    const { drawingId } = await callRpc("drawings.pickDrawing", { threadId: scope.threadId });
    if (!drawingId) return; // cancelled
    const { drawing } = await callRpc("drawings.getDrawing", { id: drawingId });
    if (!drawing) throw new Error("Drawing not found");
    const { blobToBase64, parseScene, renderSceneToPng } = await import("./scene");
    const pngBase64 = await blobToBase64(await renderSceneToPng(parseScene(drawing.data)));
    await callRpc("drawings.attachDrawingImage", { threadId: scope.threadId, drawingId, pngBase64 });
    toast.success("Drawing PNG attached");
  } catch (error) {
    toast.error(errorMessage(error));
  }
}
