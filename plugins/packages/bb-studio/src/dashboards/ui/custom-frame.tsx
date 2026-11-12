// Custom widgets: the widget's HTML in a sandboxed frame, like Pages' HTML
// blocks. Scripts run, in an opaque origin (no same-origin), with no network
// (CSP connect-src 'none'). Studio hands it {data, options, theme, size} by
// postMessage; it may post back {height}.
import { useEffect, useMemo, useRef, useState } from "react";

export const STATE_MESSAGE = "bb-widget-state";
export const READY_MESSAGE = "bb-widget-ready";
export const HEIGHT_MESSAGE = "bb-widget-height";
export const SANDBOX = "allow-scripts";
export const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'";
const MAX_HEIGHT = 4000;

// Runs first in the frame: window.bbWidget, the `bbwidget` event, theme
// colors as --bb-* variables, and the ready and height messages.
const BOOT = `(function(){var state={data:null,options:{},theme:{mode:"light",colors:{}},size:{width:0,height:0}};window.bbWidget=state;
function apply(next){state.data=next.data===undefined?null:next.data;state.options=next.options||{};state.theme=next.theme||state.theme;state.size=next.size||state.size;var root=document.documentElement;root.style.colorScheme=state.theme.mode;var colors=state.theme.colors||{};for(var key in colors){if(typeof colors[key]==="string")root.style.setProperty("--bb-"+key,colors[key])}window.dispatchEvent(new CustomEvent("bbwidget",{detail:state}))}
addEventListener("message",function(event){if(event.source!==parent)return;var d=event.data;if(d&&d.type==="${STATE_MESSAGE}")apply(d)});
var last=0;function post(){var h=Math.ceil(document.documentElement.scrollHeight);if(h!==last){last=h;parent.postMessage({type:"${HEIGHT_MESSAGE}",height:h},"*")}}
addEventListener("load",function(){parent.postMessage({type:"${READY_MESSAGE}"},"*");if(window.ResizeObserver&&document.body)new ResizeObserver(post).observe(document.body);post()});})();`;

/** The frame's document: CSP first, then the boot script, then the widget. */
export function customSrcDoc(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><style>html,body{margin:0;padding:0;background:transparent;color:var(--bb-foreground,inherit);font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}</style><script>${BOOT}</script></head><body>${html}</body></html>`;
}

export interface WidgetTheme {
  mode: "light" | "dark";
  colors: Record<string, string | string[]>;
}

export function CustomFrame({ html, title, data, options, theme, width, height }: {
  html: string;
  title: string;
  data: unknown;
  options: Record<string, unknown>;
  theme: WidgetTheme;
  width: number;
  height: number;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [asked, setAsked] = useState<number | null>(null);
  const srcDoc = useMemo(() => customSrcDoc(html), [html]);
  useEffect(() => setReady(false), [srcDoc]);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const message = event.data as { type?: unknown; height?: unknown } | null;
      if (message?.type === READY_MESSAGE) setReady(true);
      // `{height}` alone works too.
      if ((message?.type === HEIGHT_MESSAGE || message?.type === undefined) && typeof message?.height === "number" && Number.isFinite(message.height)) {
        setAsked(Math.min(MAX_HEIGHT, Math.max(0, Math.ceil(message.height))));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      frame.current?.contentWindow?.postMessage({ type: STATE_MESSAGE, data, options, theme, size: { width, height } }, "*");
    } catch {
      // Data that can't be cloned never reaches the frame.
    }
  }, [ready, data, options, theme, width, height]);
  return (
    <iframe
      ref={frame}
      title={title}
      srcDoc={srcDoc}
      sandbox={SANDBOX}
      referrerPolicy="no-referrer"
      loading="lazy"
      style={{ height: Math.max(height, asked ?? 0), colorScheme: theme.mode }}
      className="block w-full border-0 bg-transparent"
    />
  );
}
