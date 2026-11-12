// Embeds on a page: a map, a video or a song from a site that offers them as embeds, framed by Visual Chat's
// own UI over a placeholder the agent marks in its page. The page frame stays as it is (no frames, no
// network but https pictures); it only reports where each committed placeholder sits (kit: cv.embeds).
//
// The agent never gives a URL. It marks <div data-embed="map" data-q="…" data-cv-id="map">, and this file
// builds the URL from those fields, for a fixed set of providers, after validating every field. A placeholder
// with a raw URL, an unknown kind or a bad field is skipped. Everything here runs in the trusted UI, and
// everything it reads comes from the untrusted frame.

export const EMBED_MESSAGE = "bb-canvas-embeds";
/** The only origins an embed can load. Each built URL is checked against them. */
export const EMBED_ORIGINS = ["https://maps.google.com", "https://www.openstreetmap.org", "https://www.youtube-nocookie.com", "https://open.spotify.com"] as const;
/** The embed's own sandbox: its own origin (a different one from BB's), scripts, popups (BB opens them in the browser) and fullscreen video. Never top navigation. */
export const EMBED_SANDBOX = "allow-scripts allow-same-origin allow-popups allow-presentation";
/**
 * A webpage part's own sandbox, when its site allows framing: its own origin and scripts (pages break without
 * storage), and nothing else: no popups, forms, downloads or top navigation. The Open button opens it in full.
 */
export const PAGE_SANDBOX = "allow-scripts allow-same-origin";
export const EMBED_KINDS = ["map", "point", "youtube", "spotify", "page"] as const;
export type EmbedKind = (typeof EMBED_KINDS)[number];
export const SPOTIFY_KINDS = ["track", "album", "playlist"] as const;
/** At most this many embeds on a page, and this many kept alive (hidden) for a later version. */
export const MAX_EMBEDS = 8;
export const MAX_KEPT = 12;

/** The placeholder's data-* fields as the frame read them (all strings, all untrusted). */
export interface EmbedFields {
  embed?: unknown;
  q?: unknown;
  lat?: unknown;
  lon?: unknown;
  zoom?: unknown;
  label?: unknown;
  id?: unknown;
  kind?: unknown;
  start?: unknown;
  url?: unknown;
}

export interface BuiltEmbed {
  kind: EmbedKind;
  url: string;
  title: string;
  referrerPolicy: "no-referrer" | "strict-origin-when-cross-origin";
  allow: string;
  /** "page": a URL the agent gave, shown only after the server checks where it came from (canvas.webpage). */
  sandbox: string;
}

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return clean && clean.length <= max ? clean : null;
};
const LOOKS_LIKE_URL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|www\.)/i;
const decimal = (value: unknown, min: number, max: number): number | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim();
  if (!/^-?\d{1,3}(?:\.\d{1,10})?$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};
const fixed = (n: number) => String(Math.round(n * 1e6) / 1e6);

/** The URL for an embed, from its fields, or null when a field is missing or wrong. Never takes a URL. */
export function buildEmbed(fields: EmbedFields, mode: "light" | "dark" = "light"): BuiltEmbed | null {
  const kind = typeof fields.embed === "string" ? fields.embed.trim().toLowerCase() : "";
  let built: Omit<BuiltEmbed, "sandbox"> | null = null;
  if (kind === "page") {
    // The one kind with a URL from the agent: https on a public-looking host here; the server then checks it
    // came from the user or the agent's own fetch or search (canvas.webpage) before anything is framed.
    const url = pageUrl(fields.url);
    return url ? { kind, url, title: text(fields.label, 120) ?? new URL(url).hostname.replace(/^www\./, ""), referrerPolicy: "no-referrer", allow: "", sandbox: PAGE_SANDBOX } : null;
  }
  if (kind === "map") {
    // Google finds the places for a query (no key): "retro game stores near 10604".
    const q = text(fields.q, 200);
    if (!q || LOOKS_LIKE_URL.test(q)) return null;
    built = { kind, url: `https://maps.google.com/maps?q=${encodeURIComponent(q)}&output=embed`, title: `Map: ${q}`, referrerPolicy: "no-referrer", allow: "fullscreen" };
  } else if (kind === "point") {
    // One known point, on OpenStreetMap, with a marker. Only with coordinates from research.
    const lat = decimal(fields.lat, -85, 85), lon = decimal(fields.lon, -180, 180);
    if (lat === null || lon === null) return null;
    const zoom = fields.zoom === undefined || fields.zoom === "" ? 15 : decimal(fields.zoom, 3, 18);
    if (zoom === null) return null;
    const dLon = 0.012 * 2 ** (15 - Math.round(zoom)), dLat = dLon * 0.55;
    const box = [Math.max(-180, lon - dLon), Math.max(-85, lat - dLat), Math.min(180, lon + dLon), Math.min(85, lat + dLat)].map(fixed).join(",");
    const label = text(fields.label, 120);
    built = { kind, url: `https://www.openstreetmap.org/export/embed.html?bbox=${box}&layer=mapnik&marker=${fixed(lat)},${fixed(lon)}`, title: label ? `Map: ${label}` : "Map", referrerPolicy: "strict-origin-when-cross-origin", allow: "fullscreen" };
  } else if (kind === "youtube") {
    // YouTube asks embedders to send a referrer (the origin is enough).
    const id = typeof fields.id === "string" ? fields.id.trim() : "";
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
    const start = fields.start === undefined || fields.start === "" ? 0 : Number(fields.start);
    if (!Number.isInteger(start) || start < 0 || start > 86400) return null;
    built = { kind, url: `https://www.youtube-nocookie.com/embed/${id}?rel=0${start ? `&start=${start}` : ""}`, title: text(fields.label, 120) ?? "YouTube video", referrerPolicy: "strict-origin-when-cross-origin", allow: "autoplay; encrypted-media; picture-in-picture; fullscreen" };
  } else if (kind === "spotify") {
    const what = typeof fields.kind === "string" ? fields.kind.trim().toLowerCase() : "track";
    const id = typeof fields.id === "string" ? fields.id.trim() : "";
    if (!(SPOTIFY_KINDS as readonly string[]).includes(what) || !/^[A-Za-z0-9]{22}$/.test(id)) return null;
    // theme=0 is Spotify's dark player; without it, the player takes the artwork's colour.
    built = { kind, url: `https://open.spotify.com/embed/${what}/${id}${mode === "dark" ? "?theme=0" : ""}`, title: text(fields.label, 120) ?? `Spotify ${what}`, referrerPolicy: "strict-origin-when-cross-origin", allow: "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" };
  }
  if (!built) return null;
  // The allowlist, checked on the URL as built.
  return (EMBED_ORIGINS as readonly string[]).includes(new URL(built.url).origin) ? { ...built, sandbox: EMBED_SANDBOX } : null;
}

/** A webpage part's URL: https, a host name with a dot (no IP, localhost or .local), no credentials or port. As webpageUrl on the server. */
export function pageUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 2000) return null;
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || /\.(localhost|local|internal)$/.test(host) || /^[\d.]+$/.test(host) || host.includes(":")) return null;
  return url.toString();
}

export interface EmbedRect { x: number; y: number; w: number; h: number }
export interface PlacedEmbed extends BuiltEmbed {
  /** The part's data-cv-id and the built URL: the same key in a later version keeps the same frame (no reload). */
  key: string;
  rect: EmbedRect;
}
export interface EmbedReport {
  /** A version is gliding into place: hide the embeds until the next report. */
  moving: boolean;
  embeds: PlacedEmbed[];
}

const rectOf = (value: unknown): EmbedRect | null => {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const x = n(r.x), y = n(r.y), w = n(r.w), h = n(r.h);
  if (x === null || y === null || w === null || h === null || w < 1 || h < 1) return null;
  const clamp = (v: number) => Math.max(-100000, Math.min(100000, Math.round(v)));
  return { x: clamp(x), y: clamp(y), w: Math.min(8000, Math.round(w)), h: Math.min(8000, Math.round(h)) };
};

/** A report from the page frame, validated: each placeholder's fields become a built embed, or are dropped. */
export function readEmbedReport(data: unknown, mode: "light" | "dark"): EmbedReport | null {
  if (!data || typeof data !== "object" || (data as { type?: unknown }).type !== EMBED_MESSAGE) return null;
  const d = data as { moving?: unknown; embeds?: unknown };
  const list = Array.isArray(d.embeds) ? d.embeds.slice(0, MAX_EMBEDS) : [];
  const embeds: PlacedEmbed[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as { id?: unknown; fields?: unknown; rect?: unknown };
    const id = typeof e.id === "string" && /^[\w:.-]{1,80}$/.test(e.id) ? e.id : null;
    const rect = rectOf(e.rect);
    const built = id && rect && e.fields && typeof e.fields === "object" ? buildEmbed(e.fields as EmbedFields, mode) : null;
    if (!id || !rect || !built) continue;
    const key = `${id} ${built.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    embeds.push({ ...built, key, rect });
  }
  return { moving: d.moving === true, embeds };
}

/**
 * The frames to render, in a stable order: every embed in the report (placed), then the ones from earlier
 * versions kept alive but hidden, oldest dropped first past MAX_KEPT. The order never changes for a kept
 * frame, because moving an iframe in the DOM reloads it.
 */
export function keepEmbeds(kept: readonly PlacedEmbed[], report: EmbedReport): { embed: PlacedEmbed; shown: boolean }[] {
  const now = new Map(report.embeds.map((e) => [e.key, e]));
  const out: { embed: PlacedEmbed; shown: boolean }[] = kept.map((e) => (now.has(e.key) ? { embed: now.get(e.key)!, shown: true } : { embed: e, shown: false }));
  for (const e of report.embeds) if (!kept.some((k) => k.key === e.key)) out.push({ embed: e, shown: true });
  // Past the limit, the oldest hidden frames go.
  let extra = out.length - MAX_KEPT;
  return extra > 0 ? out.filter((entry) => entry.shown || extra-- <= 0) : out;
}
