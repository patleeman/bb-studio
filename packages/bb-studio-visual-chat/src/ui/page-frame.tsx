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
// Embeds (a map, a video, a song) are framed over the page by this component, not in it: the page marks a
// placeholder (data-embed and a few fields) and reports where it sits; EmbedLayer builds the URL from the
// fields for a fixed set of providers (src/ui/embeds.ts) and keeps each frame alive across versions.
import { useEffect, useMemo, useRef, useState } from "react";
import { EMBED_MESSAGE, keepEmbeds, readEmbedReport, type EmbedReport, type PlacedEmbed } from "./embeds";
import type { OrganicLook } from "../looks";
import type { BbTheme } from "../theme";
import { useBbTheme } from "./bb-theme";
import { canvasKit } from "./kit";
import { kitCss, tokenCss } from "./kit-css";

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
.cv-wall>[data-cv-pending]>*{visibility:hidden}
[data-embed]{position:relative;display:flex;align-items:center;justify-content:center;min-height:240px;padding:16px;border-radius:var(--cv-radius);border:1px solid var(--cv-rule);background:color-mix(in srgb,var(--cv-ink) 5%,var(--cv-paper));color:var(--cv-muted);font-size:var(--cv-t-sm);text-align:center;overflow:hidden}
[data-embed]:empty::after{content:attr(data-label)}
[data-embed="map"]:empty:not([data-label])::after{content:"Map · " attr(data-q)}
[data-embed="youtube"]{aspect-ratio:16/9;min-height:0}
[data-embed="spotify"]{min-height:152px}
[data-embed="page"]{min-height:420px}
[data-embed="spotify"][data-kind="album"],[data-embed="spotify"][data-kind="playlist"]{min-height:352px}`;

/** The page's CSS for a style on BB's theme: its tokens, a base, the kit's classes. */
export function pageCss(look: OrganicLook, theme: BbTheme): string {
  return `${tokenCss(look, theme, ":root")}${FLUID}${BASE}${kitCss(look, "")}`;
}

/** The frame's document: CSP, an empty style (sent on ready), the boot script and the kit. */
export function pageSrcDoc(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}"><meta name="referrer" content="no-referrer"><style id="cv-style"></style><script>${BOOT}</script><script>(${canvasKit.toString()})(window);</script></head><body><div id="cv-page"></div></body></html>`;
}

export function PageFrame({ html, stream = null, streamN = 0, rev, look, mode, title, services }: {
  html: string | null;
  /** The page the agent is writing, so far (null: none). It shows instead of html until it ends. */
  stream?: string | null;
  streamN?: number;
  rev: number;
  look: OrganicLook;
  mode: "light" | "dark";
  title: string;
  /** For webpage parts: the server's check and BB's openUrl. */
  services?: EmbedServices;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const srcDoc = useMemo(() => pageSrcDoc(), []);
  const [ready, setReady] = useState(false);
  const [embedData, setEmbedData] = useState<unknown>(null);
  const shown = useRef<string | null>(null);
  const streamed = useRef<string | null>(null);
  const post = (message: unknown) => { try { frame.current?.contentWindow?.postMessage(message, "*"); } catch { /* the frame is gone */ } };
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const type = (event.data as { type?: unknown } | null)?.type;
      if (type === PAGE_READY_MESSAGE) setReady(true);
      if (type === EMBED_MESSAGE) setEmbedData(event.data);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  // BB's theme, live: a palette switch or light/dark restyles the page in place (no reload).
  const theme = useBbTheme();
  useEffect(() => {
    if (ready) post({ type: STYLE_MESSAGE, css: pageCss(look, theme), look, mode: theme.mode });
  }, [ready, look, theme]);
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
  const embeds = useMemo(() => readEmbedReport(embedData, theme.mode), [embedData, theme.mode]);
  return (
    <div className="relative size-full" data-canvas-page-box>
    <iframe
      ref={frame}
      title={title}
      srcDoc={srcDoc}
      sandbox={PAGE_SANDBOX}
      referrerPolicy="no-referrer"
      className="block size-full border-0 bg-transparent"
      style={{ colorScheme: mode }}
      data-canvas-page-frame
      data-page-rev={rev}
      data-page-ready={ready || undefined}
      data-page-streaming={stream !== null || undefined}
    />
    {embeds ? <EmbedLayer report={embeds} services={services} /> : null}
    </div>
  );
}

/** The page frame's own sandbox: scripts in an opaque origin (no allow-same-origin), no navigation or popups. */
export const PAGE_SANDBOX = "allow-scripts";

/** What the server says about a webpage part's URL (canvas.webpage). */
export interface WebpageAnswer {
  status: "unverified" | "invalid" | "frame" | "card";
  url: string;
  source: string | null;
  card: { title: string; site: string; summary: string | null; image: string | null } | null;
}
/** What embeds need from Visual Chat: the webpage check, and BB's openUrl for the Open button. */
export interface EmbedServices {
  webpage?: (url: string) => Promise<WebpageAnswer>;
  openUrl?: (url: string) => void;
}

/**
 * The embeds, over the page frame and clipped to it: each at its placeholder's place, hidden while a version
 * glides and faded back in after. A frame whose part (data-cv-id) and built URL are in a later version stays
 * the same element, so it doesn't reload; one that's gone stays alive, hidden, for a while (keepEmbeds).
 */
export function EmbedLayer({ report, services = {} }: { report: EmbedReport; services?: EmbedServices }) {
  const kept = useRef<PlacedEmbed[]>([]);
  const entries = useMemo(() => {
    const next = keepEmbeds(kept.current, report);
    kept.current = next.map((entry) => entry.embed);
    return next;
  }, [report]);
  if (!entries.length) return null;
  const place = (embed: PlacedEmbed, shown: boolean) => ({
    left: embed.rect.x,
    top: embed.rect.y,
    width: embed.rect.w,
    height: embed.rect.h,
    visibility: shown ? "visible" as const : "hidden" as const,
    pointerEvents: shown && !report.moving ? "auto" as const : "none" as const,
    borderRadius: "var(--radius)",
    background: "var(--card)",
    boxShadow: "0 0 0 1px var(--border)",
  });
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ opacity: report.moving ? 0 : 1, transition: `opacity ${report.moving ? 120 : 280}ms ease-out` }} data-canvas-embeds data-embeds-moving={report.moving || undefined}>
      {entries.map(({ embed, shown }) => embed.kind === "page" ? (
        <div key={embed.key} className="absolute overflow-hidden" style={place(embed, shown)} data-canvas-embed="page" data-embed-key={embed.key} data-embed-shown={shown || undefined}>
          <WebpageEmbed embed={embed} services={services} />
        </div>
      ) : (
        <iframe
          key={embed.key}
          src={embed.url}
          title={embed.title}
          sandbox={embed.sandbox}
          referrerPolicy={embed.referrerPolicy}
          allow={embed.allow}
          allowFullScreen
          loading="lazy"
          className="absolute border-0"
          style={place(embed, shown)}
          data-canvas-embed={embed.kind}
          data-embed-key={embed.key}
          data-embed-shown={shown || undefined}
        />
      ))}
    </div>
  );
}

/**
 * A webpage part: nothing until the server says where its URL came from. A verified page that allows framing
 * is framed (its own sandbox: no popups, forms, downloads or top navigation); one that doesn't is a link card.
 * Either way the Open button opens it with BB's openUrl (BB's browser beside the board on desktop, else the
 * external browser), and only when the user clicks it. An unverified URL shows only a note.
 */
function WebpageEmbed({ embed, services }: { embed: PlacedEmbed; services: EmbedServices }) {
  const [answer, setAnswer] = useState<WebpageAnswer | "failed" | null>(null);
  const { webpage } = services;
  useEffect(() => {
    let live = true;
    if (!webpage) { setAnswer("failed"); return; }
    webpage(embed.url).then((next) => { if (live) setAnswer(next); }, () => { if (live) setAnswer("failed"); });
    return () => { live = false; };
  }, [embed.url, webpage]);
  const note = (text: string, state: string) => <div className="flex size-full items-center justify-center p-3 text-center text-xs text-muted-foreground" data-webpage-state={state}>{text}</div>;
  if (answer === null) return note("Checking the link…", "checking");
  if (answer === "failed") return note("Couldn't check the link.", "failed");
  if (answer.status === "unverified" || answer.status === "invalid") return note("Link not verified: it didn't come from you or from a page the agent read.", "unverified");
  const open = (
    <button
      type="button"
      className="absolute right-2 top-2 z-10 rounded-md border border-border bg-background/90 px-2 py-1 text-xs font-medium text-foreground shadow-sm hover:bg-accent"
      onClick={() => services.openUrl?.(answer.url)}
      title={`Open ${answer.url}`}
      data-webpage-open
    >
      Open ↗
    </button>
  );
  if (answer.status === "frame") {
    return (
      <>
        <iframe src={answer.url} title={answer.card?.title ?? embed.title} sandbox={embed.sandbox} referrerPolicy="no-referrer" loading="lazy" className="block size-full border-0 bg-background" data-webpage-state="frame" />
        {open}
      </>
    );
  }
  const card = answer.card ?? { title: embed.title, site: new URL(answer.url).hostname, summary: null, image: null };
  // OpenGraph pictures are wide (1.91:1): on top in a card with the height for it, else beside, shown whole.
  const top = embed.rect.h >= 280;
  return (
    <div className={`flex size-full overflow-hidden bg-card text-card-foreground ${top ? "flex-col" : "flex-row"}`} data-webpage-state="card">
      {card.image ? <img src={card.image} alt="" referrerPolicy="no-referrer" className={top ? "w-full shrink-0 object-cover" : "h-full w-2/5 shrink-0 bg-muted object-contain"} style={top ? { aspectRatio: "1.91 / 1", maxHeight: "58%" } : undefined} /> : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-4 pr-20">
        <div className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{card.site}</div>
        <div className="line-clamp-3 text-base font-semibold leading-snug">{card.title}</div>
        {card.summary ? <p className="line-clamp-4 text-sm leading-relaxed text-muted-foreground">{card.summary}</p> : null}
        <div className="mt-auto truncate text-xs text-muted-foreground">{new URL(answer.url).hostname.replace(/^www\./, "")}</div>
      </div>
      {open}
    </div>
  );
}
