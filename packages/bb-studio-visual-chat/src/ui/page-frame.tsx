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
import { useBbTheme } from "./bb-theme";
import { createPagePoster, embedLayerStyle, embedPlacement, pageSrcDoc, PAGE_READY_MESSAGE, PAGE_SANDBOX, styleMessage, webpageView, type EmbedServices, type WebpageAnswer } from "./renderer";

// The frame document, the page poster and the overlay's logic are the shared renderer's (renderer.ts), which
// the iOS app draws boards with too (bundle/canvas-renderer.js, canvas.renderer).
export { PAGE_CSP, PAGE_MESSAGE, PAGE_READY_MESSAGE, PAGE_SANDBOX, STREAM_MESSAGE, STYLE_MESSAGE, pageCss, pageSrcDoc, type EmbedServices, type WebpageAnswer } from "./renderer";

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
  const poster = useRef(createPagePoster());
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
    if (ready) post(styleMessage(look, theme));
  }, [ready, look, theme]);
  useEffect(() => {
    if (!ready) return;
    for (const message of poster.current.next({ html, stream, streamN, rev })) post(message);
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
  const place = (embed: PlacedEmbed, shown: boolean) => embedPlacement(embed, shown, report.moving);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" style={embedLayerStyle(report.moving)} data-canvas-embeds data-embeds-moving={report.moving || undefined}>
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
  const view = webpageView(embed, answer);
  if ("note" in view) {
    return <div className="flex size-full items-center justify-center p-3 text-center text-xs text-muted-foreground" data-webpage-state={view.state}>{view.note}</div>;
  }
  const open = (
    <button
      type="button"
      className="absolute right-2 top-2 z-10 rounded-md border border-border bg-background/90 px-2 py-1 text-xs font-medium text-foreground shadow-sm hover:bg-accent"
      onClick={() => services.openUrl?.(view.url)}
      title={`Open ${view.url}`}
      data-webpage-open
    >
      Open ↗
    </button>
  );
  if (view.state === "frame") {
    return (
      <>
        <iframe src={view.url} title={view.title} sandbox={view.sandbox} referrerPolicy="no-referrer" loading="lazy" className="block size-full border-0 bg-background" data-webpage-state="frame" />
        {open}
      </>
    );
  }
  const { card, top } = view;
  // Always shown whole, never cropped.
  return (
    <div className={`flex size-full overflow-hidden bg-card text-card-foreground ${top ? "flex-col" : "flex-row"}`} data-webpage-state="card">
      {card.image ? <img src={card.image} alt="" referrerPolicy="no-referrer" className={top ? "w-full shrink-0 bg-muted object-contain" : "h-full w-2/5 shrink-0 bg-muted object-contain"} style={top ? { aspectRatio: "1.91 / 1", maxHeight: "58%" } : undefined} /> : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-4 pr-20">
        <div className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{card.site}</div>
        <div className="line-clamp-3 text-base font-semibold leading-snug">{card.title}</div>
        {card.summary ? <p className="line-clamp-4 text-sm leading-relaxed text-muted-foreground">{card.summary}</p> : null}
        <div className="mt-auto truncate text-xs text-muted-foreground">{view.host}</div>
      </div>
      {open}
    </div>
  );
}
