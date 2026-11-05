// The canvas page as one component, the entry of the prebuilt bundle
// (build-ui.mjs → bundle/canvas-ui.js): /plugins/studio-visual-chat/canvas for a new canvas,
// /plugins/studio-visual-chat/canvas/<threadId> for one. The quick card
// (src/quick-app.tsx) loads QuickCard from the same bundle.
import CanvasRoute from "./route";

export { QuickCard } from "./quick-card";

export function CanvasPanel({ subPath }: { subPath: string }) {
  return <CanvasRoute rest={subPath.replace(/^\/+|\/+$/g, "")} />;
}
