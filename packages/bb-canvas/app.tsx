// Canvas (prototype): its page in BB's rail, /plugins/canvas/canvas for a
// new canvas and /plugins/canvas/canvas/<threadId> for one. The page and
// its board are src/ui; they reuse Studio's widget renderers at build time.
import { definePluginApp, type PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import { lazy, Suspense } from "react";
import "./src/ui/canvas.css";

const CanvasRoute = lazy(() => import("./src/ui/route"));

function CanvasPanel({ subPath }: PluginNavPanelProps) {
  return <Suspense fallback={null}><CanvasRoute rest={subPath.replace(/^\/+|\/+$/g, "")} /></Suspense>;
}

export default definePluginApp((app) => {
  app.slots.navPanel({ id: "canvas", title: "Canvas", icon: "GridView", path: "canvas", component: CanvasPanel });
});
