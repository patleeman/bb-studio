// A custom item's frame in an organic look: the agent's HTML, sandboxed
// like Dashboards' custom widgets (scripts in an opaque origin, no network),
// with the look's tokens on BB's theme, the kit's CSS classes and window.cv
// injected, and sized to its content: the frame reports #cv-root's height, so
// the item is as tall as what it draws. The tokens ride along with every state
// message too, so a change of BB's theme restyles the frame in place.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OrganicLook } from "../looks";
import type { BbTheme } from "../theme";
import { useBbTheme } from "./bb-theme";
import { canvasKit } from "./kit";
import { kitCss, tokenCss } from "./kit-css";

export const STATE_MESSAGE = "bb-widget-state";
export const READY_MESSAGE = "bb-widget-ready";
export const HEIGHT_MESSAGE = "bb-widget-height";
export const SANDBOX = "allow-scripts";
export const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'";
const MAX_HEIGHT = 4000;

// window.bbWidget and the `bbwidget` event (as Dashboards' frames have),
// then the content height of #cv-root, posted whenever it changes.
const BOOT = `(function(){var state={data:null,options:{},theme:{mode:"light",colors:{}},size:{width:0,height:0},received:false};window.bbWidget=state;
function apply(next){if(typeof next.tokens==="string"){var t=document.getElementById("cv-tokens");if(t&&t.textContent!==next.tokens)t.textContent=next.tokens}state.data=next.data===undefined?null:next.data;state.options=next.options||{};state.theme=next.theme||state.theme;state.size=next.size||state.size;state.received=true;window.dispatchEvent(new CustomEvent("bbwidget",{detail:state}))}
addEventListener("message",function(event){if(event.source!==parent)return;var d=event.data;if(d&&d.type==="${STATE_MESSAGE}")apply(d)});
var last=-1;function post(){var root=document.getElementById("cv-root");if(!root)return;var h=Math.ceil(root.getBoundingClientRect().height);if(h!==last){last=h;parent.postMessage({type:"${HEIGHT_MESSAGE}",height:h},"*")}}
addEventListener("load",function(){parent.postMessage({type:"${READY_MESSAGE}"},"*");var root=document.getElementById("cv-root");if(window.ResizeObserver&&root)new ResizeObserver(post).observe(root);post();setTimeout(post,300)});})();`;

/** cv.render waits for the first state, so a component never draws without its data. */
const RENDER_PATCH = `(function(){var render=window.cv.render;window.cv.render=function(build){if(window.bbWidget.received)return render(build);var go=function(){window.removeEventListener("bbwidget",go);render(build)};window.addEventListener("bbwidget",go)}})();`;

/** A frame's tokens: the look on BB's theme, for its #cv-tokens style. */
export function frameTokens(look: OrganicLook, theme: BbTheme): string {
  return tokenCss(look, theme, ":root");
}

/** The frame's document: CSP, tokens (their own style, so they can change), the kit, then the agent's HTML in #cv-root. */
export function frameSrcDoc(html: string, look: OrganicLook, theme: BbTheme): string {
  const mode = theme.mode;
  const css = `html,body{margin:0;padding:0;background:transparent;color:var(--cv-ink);font-family:var(--cv-font-text);font-size:var(--cv-t-md);line-height:1.45;-webkit-font-smoothing:antialiased}#cv-root{display:flow-root}*{box-sizing:border-box}img,svg{max-width:100%}${kitCss(look, "")}`;
  const kit = `(${canvasKit.toString()})(window);`;
  return `<!doctype html><html data-cv-look="${look}" data-cv-mode="${mode}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><style id="cv-tokens">${frameTokens(look, theme)}</style><style>${css}</style><script>${BOOT}</script><script>${kit}${RENDER_PATCH}</script></head><body><div id="cv-root" class="cv-root">${html}</div></body></html>`;
}

/** The state message a frame gets: its data, options, size, and its tokens on BB's current theme. */
export function frameState({ data, options, mode, width, room, height, look, theme }: { data: unknown; options: Record<string, unknown>; mode: "light" | "dark"; width: number; room?: number; height: number | null; look: OrganicLook; theme: BbTheme }) {
  return { type: STATE_MESSAGE, data, options, theme: { mode, colors: {} }, tokens: frameTokens(look, theme), size: { width, height: height ?? 0, room: room ?? 0 } };
}

export function CanvasFrame({ html, title, data, options, look, mode, width, room, onHeight }: {
  html: string;
  title: string;
  data: unknown;
  options: Record<string, unknown>;
  look: OrganicLook;
  mode: "light" | "dark";
  width: number;
  /** The height its place in the composition suggests (cv.height()). */
  room?: number;
  /** The content's height once the frame has reported it. */
  onHeight?(height: number): void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const theme = useBbTheme();
  const themeNow = useRef(theme);
  themeNow.current = theme;
  // The document starts on the theme of its making; later changes arrive as tokens in the state message.
  const srcDoc = useMemo(() => frameSrcDoc(html, look, themeNow.current), [html, look, mode]);
  // Ready per document, never reset by an effect: a frame can report ready
  // before this component's effects run, and a reset then would leave it
  // waiting for its data forever.
  const [readyDoc, setReadyDoc] = useState<string | null>(null);
  const ready = readyDoc === srcDoc;
  const latest = useRef({ srcDoc, data, options, mode, width, room, height, onHeight, look, theme });
  latest.current = { srcDoc, data, options, mode, width, room, height, onHeight, look, theme };
  const send = useCallback(() => {
    const { data: d, options: o, mode: m, width: w, room: r, height: h, look: l, theme: t } = latest.current;
    try {
      frame.current?.contentWindow?.postMessage(frameState({ data: d, options: o, mode: m, width: w, room: r, height: h, look: l, theme: t }), "*");
    } catch {
      // Data that can't be cloned never reaches the frame.
    }
  }, []);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const message = event.data as { type?: unknown; height?: unknown } | null;
      if (message?.type === READY_MESSAGE) { setReadyDoc(latest.current.srcDoc); send(); }
      if (message?.type === HEIGHT_MESSAGE && typeof message.height === "number" && Number.isFinite(message.height)) {
        const next = Math.min(MAX_HEIGHT, Math.max(0, Math.ceil(message.height)));
        setHeight(next);
        latest.current.onHeight?.(next);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [send]);
  useEffect(() => { if (ready) send(); }, [ready, data, options, mode, width, room, theme, send]);
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
