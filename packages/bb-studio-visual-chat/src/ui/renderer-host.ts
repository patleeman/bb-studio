// The board renderer's host for a page without React: the iOS app's web view (bundle/canvas-renderer.js).
// It does what page-frame.tsx does on the desktop, with the same shared code (renderer.ts, embeds.ts): one
// sandboxed frame, loaded once, posted the style, the stream and each version; the embeds framed over it from
// the frame's reports, each kept alive across versions; webpage parts shown only once the host's check says
// where their URL came from. The overlay paints with BB's theme variables (--card, --border, --radius …),
// which the host page sets (hostTokenCss).
import type { OrganicLook } from "../looks";
import type { BbColor, BbTheme } from "../theme";
import { EMBED_MESSAGE, keepEmbeds, readEmbedReport, type PlacedEmbed } from "./embeds";
import { createPagePoster, embedLayerStyle, embedPlacement, pageSrcDoc, PAGE_READY_MESSAGE, PAGE_SANDBOX, styleMessage, webpageView, type EmbedServices, type PagePoster, type PageState, type WebpageAnswer } from "./renderer";

/** What the host shows: the page state, its style and the theme. */
export interface BoardState extends PageState {
  look: OrganicLook;
  theme: BbTheme;
}
/** What the host reports back after it posts: the revision and stream step the frame has now. */
export interface BoardRendered { ready: boolean; rev: number; streamN: number; streaming: boolean; embeds: number }

export interface BoardOptions {
  title?: string;
  services?: EmbedServices;
  onRendered?: (state: BoardRendered) => void;
}

/** BB's theme as the CSS variables BB gives plugin UI, for a host page outside BB. */
export function hostTokenCss(theme: BbTheme, selector = ":root"): string {
  const names: Record<BbColor, string> = {
    background: "--background", foreground: "--foreground", card: "--card", cardForeground: "--card-foreground",
    popover: "--popover", popoverForeground: "--popover-foreground", primary: "--primary", primaryForeground: "--primary-foreground",
    muted: "--muted", mutedForeground: "--muted-foreground", accent: "--accent", border: "--border",
    destructive: "--destructive", success: "--success", warning: "--warning",
  };
  const colors = (Object.keys(names) as BbColor[]).map((key) => `${names[key]}:${theme.colors[key]}`).join(";");
  return `${selector}{${colors};--radius:${theme.radius}px;--font-sans:${theme.fonts.sans};--font-serif:${theme.fonts.serif};--font-mono:${theme.fonts.mono};color-scheme:${theme.mode}}`;
}

type Style = Partial<Record<string, string | number>>;
const px = new Set(["left", "top", "width", "height"]);
function css(element: HTMLElement, style: Style) {
  for (const [key, value] of Object.entries(style)) {
    if (value === undefined) continue;
    const name = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    element.style.setProperty(name, typeof value === "number" && px.has(key) ? `${value}px` : String(value));
  }
}
function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, style: Style = {}, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  css(node, style);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}
const clamp = (lines: number): Style => ({ display: "-webkit-box", WebkitLineClamp: lines, WebkitBoxOrient: "vertical", overflow: "hidden" });

/** A webpage part: a note until the check answers, then the framed page or its link card, with Open. */
function mountWebpage(doc: Document, box: HTMLElement, embed: PlacedEmbed, services: EmbedServices) {
  let live = true;
  const draw = (answer: WebpageAnswer | "failed" | null) => {
    if (!live) return;
    const view = webpageView(embed, answer);
    box.replaceChildren();
    if ("note" in view) {
      const note = el(doc, "div", { display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", padding: "12px", textAlign: "center", fontSize: "12px", lineHeight: "16px", color: "var(--muted-foreground)", boxSizing: "border-box" }, { "data-webpage-state": view.state });
      note.textContent = view.note;
      box.append(note);
      return;
    }
    const open = el(doc, "button", { position: "absolute", right: "8px", top: "8px", zIndex: 10, borderRadius: "6px", border: "1px solid var(--border)", background: "color-mix(in srgb, var(--background) 90%, transparent)", padding: "4px 8px", fontSize: "12px", lineHeight: "16px", fontWeight: 500, color: "var(--foreground)", boxShadow: "0 1px 2px rgb(0 0 0 / 0.05)", fontFamily: "inherit", cursor: "pointer" }, { type: "button", title: `Open ${view.url}`, "data-webpage-open": "" });
    open.textContent = "Open ↗";
    open.addEventListener("click", () => services.openUrl?.(view.url));
    if (view.state === "frame") {
      const frame = el(doc, "iframe", { display: "block", width: "100%", height: "100%", border: "0", background: "var(--background)" }, { src: view.url, title: view.title, sandbox: view.sandbox, referrerpolicy: "no-referrer", loading: "lazy", "data-webpage-state": "frame" });
      box.append(frame, open);
      return;
    }
    const { card, top } = view;
    const root = el(doc, "div", { display: "flex", flexDirection: top ? "column" : "row", width: "100%", height: "100%", overflow: "hidden", background: "var(--card)", color: "var(--card-foreground)", fontFamily: "var(--font-sans)" }, { "data-webpage-state": "card" });
    if (card.image) {
      const img = el(doc, "img", top ? { width: "100%", flexShrink: 0, background: "var(--muted)", objectFit: "contain", aspectRatio: "1.91 / 1", maxHeight: "58%" } : { height: "100%", width: "40%", flexShrink: 0, background: "var(--muted)", objectFit: "contain" }, { src: card.image, alt: "", referrerpolicy: "no-referrer" });
      root.append(img);
    }
    const text = el(doc, "div", { display: "flex", minWidth: 0, flex: "1 1 0%", flexDirection: "column", gap: "6px", padding: "16px 80px 16px 16px" });
    const site = el(doc, "div", { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "11px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.025em", color: "var(--muted-foreground)" });
    site.textContent = card.site;
    const title = el(doc, "div", { ...clamp(3), fontSize: "16px", fontWeight: 600, lineHeight: 1.375 });
    title.textContent = card.title;
    text.append(site, title);
    if (card.summary) {
      const summary = el(doc, "p", { ...clamp(4), margin: 0, fontSize: "14px", lineHeight: 1.625, color: "var(--muted-foreground)" });
      summary.textContent = card.summary;
      text.append(summary);
    }
    const host = el(doc, "div", { marginTop: "auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "12px", color: "var(--muted-foreground)" });
    host.textContent = view.host;
    text.append(host);
    root.append(text, open);
    box.append(root);
  };
  draw(null);
  if (!services.webpage) draw("failed");
  else services.webpage(embed.url).then(draw, () => draw("failed"));
  return () => { live = false; };
}

/**
 * Draws a board into `container` (which it fills): the page frame and the embed overlay. update() takes the
 * latest state at any time (before the frame is ready too); destroy() takes it all down.
 */
export function mountBoard(container: HTMLElement, options: BoardOptions = {}) {
  const doc = container.ownerDocument;
  const win = doc.defaultView!;
  const services = options.services ?? {};
  const box = el(doc, "div", { position: "relative", width: "100%", height: "100%" }, { "data-canvas-page-box": "" });
  const frame = el(doc, "iframe", { display: "block", width: "100%", height: "100%", border: "0", background: "transparent" }, { title: options.title ?? "Visual Chat", sandbox: PAGE_SANDBOX, referrerpolicy: "no-referrer", "data-canvas-page-frame": "" });
  frame.srcdoc = pageSrcDoc();
  const layer = el(doc, "div", { position: "absolute", inset: "0", overflow: "hidden", pointerEvents: "none" }, { "data-canvas-embeds": "" });
  box.append(frame, layer);
  container.append(box);

  let ready = false;
  let state: BoardState | null = null;
  let poster: PagePoster = createPagePoster();
  let styled: string | null = null;
  let embedData: unknown = null;
  let kept: PlacedEmbed[] = [];
  const frames = new Map<string, { node: HTMLElement; stop?: () => void }>();
  let embedCount = 0;

  const post = (message: unknown) => { try { frame.contentWindow?.postMessage(message, "*"); } catch { /* the frame is gone */ } };

  const drawEmbeds = () => {
    const report = state ? readEmbedReport(embedData, state.theme.mode) : null;
    if (!report) return;
    const entries = keepEmbeds(kept, report);
    kept = entries.map((entry) => entry.embed);
    css(layer, embedLayerStyle(report.moving));
    if (report.moving) layer.setAttribute("data-embeds-moving", ""); else layer.removeAttribute("data-embeds-moving");
    const live = new Set(entries.map((entry) => entry.embed.key));
    for (const [key, entry] of frames) if (!live.has(key)) { entry.stop?.(); entry.node.remove(); frames.delete(key); }
    // Kept frames never move in the DOM (that reloads an iframe): keepEmbeds keeps their order, new ones go last.
    for (const { embed, shown } of entries) {
      let entry = frames.get(embed.key);
      if (!entry) {
        if (embed.kind === "page") {
          const node = el(doc, "div", { position: "absolute", overflow: "hidden" }, { "data-canvas-embed": "page", "data-embed-key": embed.key });
          entry = { node, stop: mountWebpage(doc, node, embed, services) };
        } else {
          const node = el(doc, "iframe", { position: "absolute", border: "0" }, { src: embed.url, title: embed.title, sandbox: embed.sandbox, referrerpolicy: embed.referrerPolicy, allow: embed.allow, allowfullscreen: "", loading: "lazy", "data-canvas-embed": embed.kind, "data-embed-key": embed.key });
          entry = { node };
        }
        frames.set(embed.key, entry);
        layer.append(entry.node);
      }
      css(entry.node, embedPlacement(embed, shown, report.moving));
      if (shown) entry.node.setAttribute("data-embed-shown", ""); else entry.node.removeAttribute("data-embed-shown");
    }
    embedCount = entries.filter((entry) => entry.shown).length;
  };

  const flush = () => {
    if (!state) return;
    frame.style.colorScheme = state.theme.mode;
    frame.setAttribute("data-page-rev", String(state.rev));
    if (state.stream !== null) frame.setAttribute("data-page-streaming", "true"); else frame.removeAttribute("data-page-streaming");
    if (!ready) return;
    const style = styleMessage(state.look, state.theme);
    const key = `${style.look} ${style.mode} ${style.css}`;
    if (key !== styled) { styled = key; post(style); }
    for (const message of poster.next(state)) post(message);
    options.onRendered?.({ ready, rev: state.rev, streamN: state.streamN, streaming: state.stream !== null, embeds: embedCount });
  };

  const onMessage = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow) return;
    const type = (event.data as { type?: unknown } | null)?.type;
    if (type === PAGE_READY_MESSAGE) {
      // A frame that loaded (again) starts from nothing: it gets the style and the page anew.
      ready = true;
      poster = createPagePoster();
      styled = null;
      frame.setAttribute("data-page-ready", "true");
      flush();
    }
    if (type === EMBED_MESSAGE) { embedData = event.data; drawEmbeds(); }
  };
  win.addEventListener("message", onMessage);

  return {
    update(next: BoardState) {
      const modeChanged = state?.theme.mode !== next.theme.mode;
      state = next;
      flush();
      // Embed URLs follow the mode (Spotify's dark player).
      if (modeChanged && embedData) drawEmbeds();
    },
    destroy() {
      win.removeEventListener("message", onMessage);
      for (const entry of frames.values()) entry.stop?.();
      frames.clear();
      box.remove();
    },
  };
}
export type BoardHost = ReturnType<typeof mountBoard>;
