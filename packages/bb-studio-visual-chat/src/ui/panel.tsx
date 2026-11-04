// The canvas page as one component, the entry of the prebuilt bundle
// (build-ui.mjs → bundle/canvas-ui.js): /plugins/studio-visual-chat/canvas for a new canvas,
// /plugins/studio-visual-chat/canvas/<threadId> for one.
import CanvasRoute from "./route";

export function CanvasPanel({ subPath }: { subPath: string }) {
  return <CanvasRoute rest={subPath.replace(/^\/+|\/+$/g, "")} />;
}
