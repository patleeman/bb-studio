// The entry of bundle/canvas-renderer.js (build-ui.mjs): the board renderer as one classic script for a host
// page outside BB, the iOS app's web view. It sets globalThis.BBCanvasRenderer; canvas.renderer serves the
// file with its version (a hash of its text), and the app keeps it by that version.
import { DEFAULT_LOOK, ORGANIC_LOOKS } from "../looks";
import { hostTokenCss, mountBoard } from "./renderer-host";
import { RENDERER_PROTOCOL, themeFrom } from "./renderer";

const renderer = { protocol: RENDERER_PROTOCOL, looks: ORGANIC_LOOKS, defaultLook: DEFAULT_LOOK, themeFrom, hostTokenCss, mountBoard };
export type CanvasRendererGlobal = typeof renderer;
(globalThis as { BBCanvasRenderer?: CanvasRendererGlobal }).BBCanvasRenderer = renderer;
