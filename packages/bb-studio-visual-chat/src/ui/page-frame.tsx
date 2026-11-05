// A canvas page: the agent's HTML for the whole board, in one sandboxed
// frame the size of the board (scripts in an opaque origin; no network
// except https images), with the style's tokens, the kit's CSS and
// window.cv. The frame is loaded once: each new version of the page and
// each style switch arrives as a message, and the kit morphs the page by
// data-cv-id (parts that stay glide, new ones enter, gone ones leave). The
// page scrolls inside the frame when it's taller than the screen.
// A page the agent is still writing (src/stream.ts) arrives as stream
// messages: the kit builds it part by part (cv.stream), and the finished page
// lands on it the same way, so nothing flashes.
import { useEffect, useMemo, useRef, useState } from "react";
import { tokenDeclarations, type OrganicLook } from "../looks";
import { canvasKit } from "./kit";
import { kitCss } from "./kit-css";

export const PAGE_MESSAGE = "bb-canvas-page";
export const STYLE_MESSAGE = "bb-canvas-style";
export const PAGE_READY_MESSAGE = "bb-canvas-page-ready";
export const STREAM_MESSAGE = "bb-canvas-stream";
/**
 * Pictures load straight from https addresses (canvas_image finds them):
 * the frame stays an opaque origin with no scripts, styles, fetches or
 * frames from the network, and no referrer is sent. Nothing proxies them
 * through BB's server, so there's no server-side fetch to aim inward.
 */
export const PAGE_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob: https:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";

const BOOT = `(function(){addEventListener("message",function(event){if(event.source!==parent)return;var d=event.data;if(!d)return;
if(d.type==="${STYLE_MESSAGE}"){document.getElementById("cv-style").textContent=d.css;document.documentElement.setAttribute("data-cv-look",d.look);document.documentElement.setAttribute("data-cv-mode",d.mode)}
if(d.type==="${STREAM_MESSAGE}"){window.cv.stream(document.getElementById("cv-page"),d.html,false);document.documentElement.setAttribute("data-cv-stream",String(d.n||0))}
if(d.type==="${PAGE_MESSAGE}"){var p=document.getElementById("cv-page");if(p.hasAttribute("data-cv-streaming")||p.hasAttribute("data-cv-streamed"))window.cv.stream(p,d.html,true);else window.cv.morph(p,d.html,!!d.animate);document.documentElement.removeAttribute("data-cv-stream");document.documentElement.setAttribute("data-cv-rev",String(d.rev||0))}});
addEventListener("load",function(){parent.postMessage({type:"${PAGE_READY_MESSAGE}"},"*")});})();`;

/**
 * In a page, the type scale follows the screen: --cv-t-* become fluid (vw and vh), so a page set in the
 * style's sizes grows on a big screen instead of leaving it half empty. --cv-f-hero is for one huge figure.
 * cv-fill is a full-screen layout: header, a middle row that takes the rest, footer.
 */
const FLUID = `:root{--cv-t-xs:clamp(11px,0.5vw + 0.35vh,15px);--cv-t-sm:clamp(13px,0.62vw + 0.45vh,18px);--cv-t-md:clamp(15px,0.75vw + 0.6vh,22px);--cv-t-lg:clamp(17px,0.95vw + 0.8vh,28px);--cv-t-xl:clamp(21px,1.3vw + 1.1vh,38px);--cv-t-2xl:clamp(28px,1.9vw + 1.7vh,58px);--cv-t-3xl:clamp(38px,2.8vw + 2.5vh,90px);--cv-t-4xl:clamp(52px,3.8vw + 3.4vh,124px);--cv-f-hero:clamp(80px,7vw + 7vh,260px)}
.cv-fill{min-height:calc(100vh - 60px);display:grid;grid-template-rows:auto 1fr auto;gap:clamp(16px,3vh,44px)}
.cv-fill > *{min-width:0}`;

const BASE = `html,body{margin:0;padding:0;background:var(--cv-paper);color:var(--cv-ink);font-family:var(--cv-font-text);font-size:var(--cv-t-md);line-height:1.45;-webkit-font-smoothing:antialiased;transition:background-color .6s ease,color .6s ease}
*{box-sizing:border-box}img,svg{max-width:100%}img{display:block}
body{padding:20px 32px 40px}#cv-page{min-height:calc(100vh - 60px)}
[data-cv-pending]{visibility:hidden}
.cv-wall>[data-cv-pending]{visibility:visible;background:color-mix(in srgb,var(--cv-ink) 6%,transparent);border-radius:var(--cv-radius);animation:cv-pulse 1.6s ease-in-out infinite}
.cv-wall>[data-cv-pending]>*{visibility:hidden}`;

/** The page's CSS for a style and mode: its tokens, a base, the kit's classes. */
export function pageCss(look: OrganicLook, mode: "light" | "dark"): string {
  return `:root{${tokenDeclarations(look, mode)};color-scheme:${mode}}${FLUID}${BASE}${kitCss(look, "")}`;
}

/** The frame's document: CSP, an empty style (sent on ready), the boot script and the kit. */
export function pageSrcDoc(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}"><meta name="referrer" content="no-referrer"><style id="cv-style"></style><script>${BOOT}</script><script>(${canvasKit.toString()})(window);</script></head><body><div id="cv-page"></div></body></html>`;
}

export function PageFrame({ html, stream = null, streamN = 0, rev, look, mode, title }: {
  html: string | null;
  /** The page the agent is writing, so far (null: none). It shows instead of html until it ends. */
  stream?: string | null;
  streamN?: number;
  rev: number;
  look: OrganicLook;
  mode: "light" | "dark";
  title: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const srcDoc = useMemo(() => pageSrcDoc(), []);
  const [ready, setReady] = useState(false);
  const shown = useRef<string | null>(null);
  const streamed = useRef<string | null>(null);
  const post = (message: unknown) => { try { frame.current?.contentWindow?.postMessage(message, "*"); } catch { /* the frame is gone */ } };
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      if ((event.data as { type?: unknown } | null)?.type === PAGE_READY_MESSAGE) setReady(true);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  useEffect(() => {
    if (ready) post({ type: STYLE_MESSAGE, css: pageCss(look, mode), look, mode });
  }, [ready, look, mode]);
  useEffect(() => {
    if (!ready) return;
    if (stream !== null) {
      if (streamed.current !== stream) post({ type: STREAM_MESSAGE, html: stream, n: streamN });
      streamed.current = stream;
      return;
    }
    // A stream ended: the page lands on it, even when it's the page that was there before.
    if (streamed.current !== null) { streamed.current = null; shown.current = "\u0000"; }
    if (html === null || shown.current === html) return;
    // The first page shows at once; every later version animates.
    post({ type: PAGE_MESSAGE, html, animate: shown.current !== null, rev });
    shown.current = html;
  }, [ready, html, rev, stream, streamN]);
  return (
    <iframe
      ref={frame}
      title={title}
      srcDoc={srcDoc}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      className="block size-full border-0 bg-transparent"
      style={{ colorScheme: mode }}
      data-canvas-page-frame
      data-page-rev={rev}
      data-page-ready={ready || undefined}
      data-page-streaming={stream !== null || undefined}
    />
  );
}
