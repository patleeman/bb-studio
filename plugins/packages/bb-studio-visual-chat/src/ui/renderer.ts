// The board renderer, framework-free: what the desktop page (page-frame.tsx, in React) and the iOS app
// (renderer-host.ts, built into bundle/canvas-renderer.js and served by canvas.renderer) both draw a board with.
//
// - The frame document: the sandboxed frame's CSP, its boot script, the kit (morph, the streaming partial render,
//   when page scripts run), and the page's CSS for a style on a theme.
// - The page poster: which messages a host posts into the frame as the page, the stream and the style change.
// - The embed overlay, drawn by the host over the frame: where each embed sits (from the frame's rect reports,
//   validated and built into URLs by embeds.ts) and what a webpage part shows once the server checked where its
//   URL came from.
// No DOM, no React: everything here returns strings and plain objects.
import type { OrganicLook } from "../looks";
import { bbTheme, type BbTheme, type Mode } from "../theme";
import type { PlacedEmbed } from "./embeds";
import { canvasKit } from "./kit";
import { kitCss, tokenCss } from "./kit-css";

/** The protocol the frame and its host speak. A host checks it before it trusts a cached renderer. */
export const RENDERER_PROTOCOL = 1;

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
/** The page frame's own sandbox: scripts in an opaque origin (no allow-same-origin), no navigation or popups. */
export const PAGE_SANDBOX = "allow-scripts";

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

/**
 * The frame's base. Below 700px (a phone; the client hint's NARROW_BOARD) a page's outer box never keeps a fixed
 * height: it grows with its content (its min-height still fills the screen), so parts can't run into each other.
 */
const BASE = `html,body{margin:0;padding:0;background:var(--cv-paper);color:var(--cv-ink);font-family:var(--cv-font-text);font-size:var(--cv-t-md);line-height:1.45;-webkit-font-smoothing:antialiased;transition:background-color .6s ease,color .6s ease}
*{box-sizing:border-box}img,svg{max-width:100%}img{display:block}
body{padding:20px 32px 40px}#cv-page{min-height:calc(100vh - 60px)}
[data-cv-pending]{visibility:hidden}
.cv-wall>[data-cv-pending]{visibility:visible;background:color-mix(in srgb,var(--cv-ink) 6%,transparent);border-radius:var(--cv-radius);animation:cv-pulse 1.6s ease-in-out infinite}
.cv-wall>[data-cv-pending]>*{visibility:hidden}
[data-embed]{position:relative;display:flex;align-items:center;justify-content:center;min-height:240px;padding:16px;border-radius:var(--cv-radius);border:1px solid var(--cv-rule);background:color-mix(in srgb,var(--cv-ink) 5%,var(--cv-paper));color:var(--cv-muted);font-size:var(--cv-t-sm);text-align:center;overflow:hidden}
[data-embed]:empty::after{content:attr(data-label)}
[data-embed="map"]:empty:not([data-label])::after{content:"Map · " attr(data-q)}
[data-embed="youtube"]{aspect-ratio:16/9;min-height:0}
[data-embed="spotify"]{min-height:152px}
[data-embed="page"]{min-height:420px}
[data-embed="spotify"][data-kind="album"],[data-embed="spotify"][data-kind="playlist"]{min-height:352px}
@media (max-width:700px){#cv-page>*{height:auto!important;max-height:none!important}}`;

/** The page's CSS for a style on BB's theme: its tokens, a base, the kit's classes. */
export function pageCss(look: OrganicLook, theme: BbTheme): string {
  return `${tokenCss(look, theme, ":root")}${FLUID}${BASE}${kitCss(look, "")}`;
}

/** The frame's document: CSP, an empty style (sent on ready), the boot script and the kit. */
export function pageSrcDoc(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}"><meta name="referrer" content="no-referrer"><style id="cv-style"></style><script>${BOOT}</script><script>(${canvasKit.toString()})(window);</script></head><body><div id="cv-page"></div></body></html>`;
}

/** The style message for a look on a theme (posted on ready and on every theme or style change). */
export function styleMessage(look: OrganicLook, theme: BbTheme) {
  return { type: STYLE_MESSAGE, css: pageCss(look, theme), look, mode: theme.mode };
}

/** A theme from a host's raw inputs (resolved colors, fonts, a radius), BB's defaults for anything missing. */
export const themeFrom = (mode: Mode, raw: Parameters<typeof bbTheme>[1] = {}): BbTheme => bbTheme(mode === "dark" ? "dark" : "light", raw);

/** What the host shows on the board now: the committed page, the page being written (null: none), its revision. */
export interface PageState {
  html: string | null;
  stream: string | null;
  streamN: number;
  rev: number;
}
export type PageMessage =
  | { type: typeof STREAM_MESSAGE; html: string; n: number }
  | { type: typeof PAGE_MESSAGE; html: string; animate: boolean; rev: number };

/**
 * Which messages to post into a ready frame as the page changes. A stream shows instead of the page until it
 * ends; then the page lands on it, even when it's the page that was there before. The first page shows at
 * once; every later version animates. A frame loaded again needs a new poster.
 */
export function createPagePoster() {
  let shown: string | null = null;
  let streamed: string | null = null;
  return {
    next({ html, stream, streamN, rev }: PageState): PageMessage[] {
      if (stream !== null) {
        const out: PageMessage[] = streamed !== stream ? [{ type: STREAM_MESSAGE, html: stream, n: streamN }] : [];
        streamed = stream;
        return out;
      }
      if (streamed !== null) { streamed = null; shown = "\u0000"; }
      if (html === null || shown === html) return [];
      const out: PageMessage[] = [{ type: PAGE_MESSAGE, html, animate: shown !== null, rev }];
      shown = html;
      return out;
    },
  };
}
export type PagePoster = ReturnType<typeof createPagePoster>;

/** The overlay over the frame: hidden while a version glides, faded back in after. */
export function embedLayerStyle(moving: boolean) {
  return { opacity: moving ? 0 : 1, transition: `opacity ${moving ? 120 : 280}ms ease-out` };
}

/** One embed's place over the frame (px), shown or kept alive hidden; never clickable while a version glides. */
export function embedPlacement(embed: PlacedEmbed, shown: boolean, moving: boolean) {
  return {
    left: embed.rect.x,
    top: embed.rect.y,
    width: embed.rect.w,
    height: embed.rect.h,
    visibility: shown ? "visible" as const : "hidden" as const,
    pointerEvents: shown && !moving ? "auto" as const : "none" as const,
    borderRadius: "var(--radius)",
    background: "var(--card)",
    boxShadow: "0 0 0 1px var(--border)",
  };
}

/** What the server says about a webpage part's URL (canvas.webpage). */
export interface WebpageAnswer {
  status: "unverified" | "invalid" | "frame" | "card";
  url: string;
  source: string | null;
  card: { title: string; site: string; summary: string | null; image: string | null } | null;
}
/** What embeds need from the host: the webpage check (canvas.webpage), and opening a URL in full for Open. */
export interface EmbedServices {
  webpage?: (url: string) => Promise<WebpageAnswer>;
  openUrl?: (url: string) => void;
}

export const WEBPAGE_NOTES = {
  checking: "Checking the link…",
  failed: "Couldn't check the link.",
  unverified: "Link not verified.",
} as const;

/** What a webpage part shows: a note, the framed page, or its link card; frame and card have Open. */
export type WebpageView =
  | { state: "checking" | "failed" | "unverified"; note: string }
  | { state: "frame"; url: string; title: string; sandbox: string }
  | { state: "card"; url: string; host: string; card: { title: string; site: string; summary: string | null; image: string | null }; top: boolean };

/**
 * A webpage part, from the server's answer (null: still asking; "failed": the check failed). Nothing shows but
 * a note until the server says where its URL came from: a verified page that allows framing is framed (its own
 * sandbox), one that doesn't is a link card. OpenGraph pictures are wide (1.91:1): on top in a card with the
 * height for it, else beside.
 */
export function webpageView(embed: PlacedEmbed, answer: WebpageAnswer | "failed" | null): WebpageView {
  if (answer === null) return { state: "checking", note: WEBPAGE_NOTES.checking };
  if (answer === "failed") return { state: "failed", note: WEBPAGE_NOTES.failed };
  if (answer.status === "unverified" || answer.status === "invalid") return { state: "unverified", note: WEBPAGE_NOTES.unverified };
  if (answer.status === "frame") return { state: "frame", url: answer.url, title: answer.card?.title ?? embed.title, sandbox: embed.sandbox };
  const host = new URL(answer.url).hostname;
  return { state: "card", url: answer.url, host: host.replace(/^www\./, ""), card: answer.card ?? { title: embed.title, site: host, summary: null, image: null }, top: embed.rect.h >= 280 };
}
