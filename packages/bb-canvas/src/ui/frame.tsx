// A custom item's frame in an organic look: the agent's HTML, sandboxed
// like Dashboards' custom widgets (scripts in an opaque origin, no network),
// with the look's tokens, the kit's CSS classes and window.cv injected, and
// sized to its content: the frame reports #cv-root's height, so the item is
// as tall as what it draws.
import { useEffect, useMemo, useRef, useState } from "react";
import type { OrganicLook } from "../looks";
import { tokenDeclarations } from "../looks";
import { canvasKit } from "./kit";
import { kitCss } from "./kit-css";

export const STATE_MESSAGE = "bb-widget-state";
export const READY_MESSAGE = "bb-widget-ready";
export const HEIGHT_MESSAGE = "bb-widget-height";
export const SANDBOX = "allow-scripts";
export const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'";
const MAX_HEIGHT = 4000;

// window.bbWidget and the `bbwidget` event (as Dashboards' frames have),
// then the content height of #cv-root, posted whenever it changes.
const BOOT = `(function(){var state={data:null,options:{},theme:{mode:"light",colors:{}},size:{width:0,height:0},received:false};window.bbWidget=state;
function apply(next){state.data=next.data===undefined?null:next.data;state.options=next.options||{};state.theme=next.theme||state.theme;state.size=next.size||state.size;state.received=true;window.dispatchEvent(new CustomEvent("bbwidget",{detail:state}))}
addEventListener("message",function(event){if(event.source!==parent)return;var d=event.data;if(d&&d.type==="${STATE_MESSAGE}")apply(d)});
var last=-1;function post(){var root=document.getElementById("cv-root");if(!root)return;var h=Math.ceil(root.getBoundingClientRect().height);if(h!==last){last=h;parent.postMessage({type:"${HEIGHT_MESSAGE}",height:h},"*")}}
addEventListener("load",function(){parent.postMessage({type:"${READY_MESSAGE}"},"*");var root=document.getElementById("cv-root");if(window.ResizeObserver&&root)new ResizeObserver(post).observe(root);post();setTimeout(post,300)});})();`;

/** cv.render waits for the first state, so a component never draws without its data. */
const RENDER_PATCH = `(function(){var render=window.cv.render;window.cv.render=function(build){if(window.bbWidget.received)return render(build);var go=function(){window.removeEventListener("bbwidget",go);render(build)};window.addEventListener("bbwidget",go)}})();`;

/** The frame's document: CSP, tokens, the kit, then the agent's HTML in #cv-root. */
export function frameSrcDoc(html: string, look: OrganicLook, mode: "light" | "dark"): string {
  const css = `:root{${tokenDeclarations(look, mode)};color-scheme:${mode}}html,body{margin:0;padding:0;background:transparent;color:var(--cv-ink);font-family:var(--cv-font-text);font-size:var(--cv-t-md);line-height:1.45;-webkit-font-smoothing:antialiased}#cv-root{display:flow-root}*{box-sizing:border-box}img,svg{max-width:100%}${kitCss(look, "")}`;
  const kit = `(${canvasKit.toString()})(window);`;
  return `<!doctype html><html data-cv-look="${look}" data-cv-mode="${mode}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><style>${css}</style><script>${BOOT}</script><script>${kit}${RENDER_PATCH}</script></head><body><div id="cv-root" class="cv-root">${html}</div></body></html>`;
}

export function CanvasFrame({ html, title, data, options, look, mode, width, onHeight }: {
  html: string;
  title: string;
  data: unknown;
  options: Record<string, unknown>;
  look: OrganicLook;
  mode: "light" | "dark";
  width: number;
  /** The content's height once the frame has reported it. */
  onHeight?(height: number): void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [height, setHeight] = useState<number | null>(null);
  const srcDoc = useMemo(() => frameSrcDoc(html, look, mode), [html, look, mode]);
  useEffect(() => setReady(false), [srcDoc]);
  const report = useRef(onHeight);
  report.current = onHeight;
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const message = event.data as { type?: unknown; height?: unknown } | null;
      if (message?.type === READY_MESSAGE) setReady(true);
      if (message?.type === HEIGHT_MESSAGE && typeof message.height === "number" && Number.isFinite(message.height)) {
        const next = Math.min(MAX_HEIGHT, Math.max(0, Math.ceil(message.height)));
        setHeight(next);
        report.current?.(next);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      frame.current?.contentWindow?.postMessage({ type: STATE_MESSAGE, data, options, theme: { mode, colors: {} }, size: { width, height: height ?? 0 } }, "*");
    } catch {
      // Data that can't be cloned never reaches the frame.
    }
  }, [ready, data, options, mode, width]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <iframe
      ref={frame}
      title={title}
      srcDoc={srcDoc}
      sandbox={SANDBOX}
      referrerPolicy="no-referrer"
      style={{ height: height ?? 160, width: "100%", colorScheme: mode, display: "block", border: 0, background: "transparent" }}
      data-canvas-frame
      data-frame-height={height ?? undefined}
    />
  );
}
