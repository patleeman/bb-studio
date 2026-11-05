// BB Studio Visual Chat (prototype): its page in BB's rail, /plugins/studio-visual-chat/canvas for a
// new canvas and /plugins/studio-visual-chat/canvas/<threadId> for one. The page is
// prebuilt into bundle/canvas-ui.js (build-ui.mjs) because it reuses Studio's
// widget renderers, whose npm imports BB's install-time build can't reach.
import { definePluginApp, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { lazy, Suspense } from "react";
import "./src/ui/canvas.css";

const CanvasPanel = lazy(() => import("./bundle/canvas-ui.js").then((module) => ({ default: module.CanvasPanel })));

function Panel({ subPath }: PluginNavPanelProps) {
  return <Suspense fallback={null}><CanvasPanel subPath={subPath} /></Suspense>;
}

export default definePluginApp((app) => {
  app.slots.navPanel({ id: "canvas", title: "Visual Chat", icon: "studio-visual-chat/visual-chat", path: "canvas", component: Panel });
});
