// The canvas page as one component, the entry of the prebuilt bundle
// (build-ui.mjs → ui/canvas-ui.js): /plugins/canvas/canvas for a new canvas,
// /plugins/canvas/canvas/<threadId> for one.
import CanvasRoute from "./route";

export function CanvasPanel({ subPath }: { subPath: string }) {
  return <CanvasRoute rest={subPath.replace(/^\/+|\/+$/g, "")} />;
}
