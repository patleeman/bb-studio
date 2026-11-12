// canvas_image / canvas_images: pictures for the page (box art, a product
// shot, a photo) as https addresses the page's frame may load.
//
// - query, with an Exa API key (the plugin's exaApiKey secret setting): Exa
//   search with contents; each result's image and its page's image links
//   (with alt text) are candidates, and the best match for the query wins.
// - pageUrl: the page is fetched here on the server and its main image is
//   taken (og:image, twitter:image, else the largest image in it).
// - query without a key (or when Exa finds nothing): Wikipedia's search API
//   finds the best-matching article and its page image (the original file).
//
// canvas_images looks up a batch at once, in parallel. Every answer is cached
// for a day by its query or address, in memory and in the plugin's database
// (ImageCache), so a follow-up or a retry costs nothing.
//
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import type Database from "better-sqlite3";

export interface ImageResult { url: string; alt: string; source: string; width?: number; height?: number }
export interface ImageDeps {
  /** The Exa key, or "" when none is set. */
  exaKey(): Promise<string>;
  /** For Exa's API (a fixed public host). */
  fetch?: typeof fetch;
  lookup?: (host: string) => Promise<{ address: string }[]>;
  /** How a checked page is fetched (pinnedTransport by default). */
  transport?: Transport;
  /** Answers already found (a day's worth); none: every lookup goes out. */
  cache?: ImageCacheLike;
}

/** Where found pictures are kept: get answers null when there's nothing fresh. */
export interface ImageCacheLike { get(key: string): ImageResult | null; set(key: string, image: ImageResult): void }

export const EXA_SEARCH_URL = "https://api.exa.ai/search";
export const WIKIPEDIA_API_URL = "https://en.wikipedia.org/w/api.php";
/** How long a found picture is reused. */
export const IMAGE_CACHE_MS = 24 * 60 * 60 * 1000;
/** At most this many pictures in one canvas_images call, and this many looked up at the same time. */
export const IMAGE_BATCH_MAX = 24;
const IMAGE_PARALLEL = 8;
const PAGE_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

/** Addresses a server-side fetch must never reach: private, loopback, link-local, carrier NAT, multicast, unspecified. */
export function privateAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) {
    const [a, b] = address.split(".").map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 0) || a >= 224;
  }
  if (v === 6) {
    const s = address.toLowerCase();
    // IPv4 inside IPv6 (mapped, compatible, NAT64): judged as the IPv4 address it carries.
    const embedded = /^(?:::ffff:|::|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (embedded) return privateAddress(embedded[1]!);
    const hexMapped = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(s);
    if (hexMapped) { const hi = parseInt(hexMapped[1]!, 16), lo = parseInt(hexMapped[2]!, 16); return privateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`); }
    return s === "::" || s === "::1" || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s);
  }
  return true;
}

/** One HTTP exchange, already connected to a checked address: what safeFetch needs back. */
export interface Exchange { status: number; location: string | null; type: string; body: AsyncIterable<Uint8Array> | null; close(): void; headers?: Record<string, string | string[] | undefined> }
/**
 * Sends a GET to url, connecting to exactly this IP address (the one that was checked): a lookup that always
 * answers with it, while the Host header and TLS server name (SNI) stay the URL's host. Nothing resolves the
 * name a second time, so a resolver can't answer "public" for the check and "private" for the connection.
 */
export type Transport = (url: URL, address: string, signal: AbortSignal) => Promise<Exchange>;

export const pinnedTransport: Transport = (url, address, signal) => new Promise((resolve, reject) => {
  const family = isIP(address);
  const lookup = (_host: string, options: { all?: boolean } | unknown, callback: (...args: unknown[]) => void) => {
    if (typeof options === "object" && options && (options as { all?: boolean }).all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
  const send = url.protocol === "https:" ? httpsRequest : httpRequest;
  const request = send(url, {
    method: "GET",
    lookup: lookup as never,
    servername: isIP(url.hostname) ? undefined : url.hostname,
    signal,
    headers: { "user-agent": "Mozilla/5.0 (BB Studio Visual Chat image finder)", accept: "text/html,application/xhtml+xml" },
  }, (response) => {
    resolve({
      status: response.statusCode ?? 0,
      location: typeof response.headers.location === "string" ? response.headers.location : null,
      type: String(response.headers["content-type"] ?? ""),
      body: response,
      headers: response.headers,
      close: () => response.destroy(),
    });
  });
  request.on("error", reject);
  request.end();
});

/**
 * A GET of a public http(s) page. Each hop: the host is resolved once, every address it gives must be public,
 * and the request connects to that exact address (pinnedTransport). At most 3 redirects, each checked the same
 * way; a time limit and a size cap.
 */
export async function safeFetch(url: string, deps: Pick<ImageDeps, "lookup" | "transport"> = {}): Promise<{ url: string; text: string; type: string; headers?: Record<string, string | string[] | undefined> }> {
  const resolve = deps.lookup ?? ((host: string) => dnsLookup(host, { all: true }));
  const transport = deps.transport ?? pinnedTransport;
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    const parsed = new URL(current);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Only http(s) pages can be read.");
    if (parsed.username || parsed.password) throw new Error("Addresses with credentials aren't read.");
    const host = parsed.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(host) ? [{ address: host }] : await resolve(host);
    if (!addresses.length || addresses.some((entry) => privateAddress(entry.address))) throw new Error("That address isn't a public web page.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await transport(parsed, addresses[0]!.address, controller.signal);
      if (response.status >= 300 && response.status < 400) {
        response.close();
        if (!response.location) throw new Error("A redirect with nowhere to go.");
        current = new URL(response.location, parsed).toString();
        continue;
      }
      if (response.status < 200 || response.status >= 300) { response.close(); throw new Error(`The page answered ${response.status}.`); }
      let text = "";
      if (response.body) {
        const decoder = new TextDecoder();
        let bytes = 0;
        for await (const chunk of response.body) {
          bytes += chunk.byteLength;
          text += decoder.decode(chunk, { stream: true });
          if (bytes > PAGE_BYTES) { response.close(); break; }
        }
      }
      return { url: parsed.toString(), text, type: response.type, headers: response.headers };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Too many redirects.");
}

/** Tracking parameters an image address doesn't need (and shouldn't carry to the page). */
export const TRACKING_PARAM = /^(utm_.*|fbclid|gclid|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid|_hsenc|_hsmi|ref_src|yclid|oly_.*|vero_.*)$/i;
export function stripTracking(raw: string): string {
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
    return url.toString();
  } catch { return raw; }
}

const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag)?.slice(1).find((v) => v !== undefined) ?? null;
const decode = (text: string) => text.replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const https = (raw: string | null, base: string): string | null => {
  if (!raw) return null;
  try {
    const url = new URL(decode(raw.trim()), base);
    if (url.protocol === "http:") url.protocol = "https:"; // the frame loads https only; most hosts serve both
    return url.protocol === "https:" ? stripTracking(url.toString()) : null;
  } catch { return null; }
};

/** A page's main image: og:image, twitter:image, else its largest <img> (by its width and height attributes). */
export function mainImage(html: string, pageUrl: string): ImageResult | null {
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
  const meta = (key: string) => metas.find((tag) => (attr(tag, "property") ?? attr(tag, "name"))?.toLowerCase() === key);
  const title = decode((/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim());
  for (const key of ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"]) {
    const tag = meta(key);
    const url = https(tag ? attr(tag, "content") : null, pageUrl);
    if (url) {
      const alt = decode(attr(meta("og:image:alt") ?? "", "content") ?? "") || title;
      const width = Number(attr(meta("og:image:width") ?? "", "content")) || undefined;
      const height = Number(attr(meta("og:image:height") ?? "", "content")) || undefined;
      return { url, alt, source: pageUrl, ...(width ? { width } : {}), ...(height ? { height } : {}) };
    }
  }
  let best: ImageResult | null = null;
  let bestArea = 0;
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const url = https(attr(tag, "src") ?? attr(tag, "data-src"), pageUrl);
    if (!url || /\.svg(\?|$)/i.test(url) || /sprite|icon|logo|pixel|spacer/i.test(url)) continue;
    const width = Number(attr(tag, "width")) || 0, height = Number(attr(tag, "height")) || 0;
    const area = width && height ? width * height : 1;
    if (area > bestArea) { bestArea = area; best = { url, alt: decode(attr(tag, "alt") ?? "") || title, source: pageUrl, ...(width ? { width } : {}), ...(height ? { height } : {}) }; }
  }
  return best;
}

interface ExaResult { url?: string; title?: string; image?: string; extras?: { imageLinks?: string[]; richImageLinks?: { url?: string; alt?: string; altText?: string }[] } }

/** The best candidate for a query among Exa's results: the result's own image first, then its page's images, scored by the query's words in the alt text, title and address. */
export function pickExaImage(results: readonly ExaResult[], query: string): ImageResult | null {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2);
  const score = (text: string) => words.filter((word) => text.toLowerCase().includes(word)).length;
  let best: (ImageResult & { score: number }) | null = null;
  results.forEach((result, rank) => {
    const source = result.url ?? "";
    const candidates: { url: string | null; alt: string }[] = [
      { url: https(result.image ?? null, source || "https://exa.ai"), alt: result.title ?? "" },
      ...(result.extras?.richImageLinks ?? []).map((link) => ({ url: https(link.url ?? null, source || "https://exa.ai"), alt: link.alt ?? link.altText ?? "" })),
      ...(result.extras?.imageLinks ?? []).map((link) => ({ url: https(link, source || "https://exa.ai"), alt: "" })),
    ];
    candidates.forEach((candidate, index) => {
      if (!candidate.url || /\.svg(\?|$)/i.test(candidate.url) || /sprite|icon|logo|favicon/i.test(candidate.url)) return;
      const s = score(`${candidate.alt} ${result.title ?? ""} ${candidate.url}`) * 10 - rank * 3 - (index ? 1 : 0);
      if (!best || s > best.score) best = { url: candidate.url, alt: candidate.alt || result.title || query, source, score: s };
    });
  });
  if (!best) return null;
  const { score: _score, ...image } = best as ImageResult & { score: number };
  return image;
}

interface WikiPage { title?: string; index?: number; fullurl?: string; original?: { source?: string; width?: number; height?: number }; thumbnail?: { source?: string; width?: number; height?: number } }

/** Words that say what kind of picture is wanted, not what it shows: Wikipedia searches better without them. */
const PICTURE_WORDS = /\b(box ?art|cover ?art|covers?|boxes|box|cartridges?|carts?|game ?paks?|photos?|pictures?|images?|screenshots?|official|artwork|logo|poster|product shot|jpe?g|png)\b/gi;
export const wikipediaSearchText = (query: string) => query.replace(PICTURE_WORDS, " ").replace(/\s+/g, " ").trim() || query.trim();
/** Where a platform or store starts in a query ("Tetris DX | Game Boy Color"): the thing's name is what comes before. */
const PLATFORM = /\b(game ?boy|gbc|gba|nintendo|famicom|super nintendo|snes|nes|n64|gamecube|wii|switch|playstation|ps[1-5]|psp|vita|xbox|sega|genesis|mega drive|dreamcast|atari|steam|pc|mac|ios|android|chromatic|modretro)\b/i;

const words = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const STOP = new Set(["the", "a", "an", "of", "and"]);

/**
 * The best Wikipedia article with a picture for a query, or null when no hit is about it. Among the first three
 * hits, one whose whole name starts the query wins (the longest: "Tetris DX" over "Tetris" for "Tetris DX Game
 * Boy Color"). Otherwise the first hit that has the query's first word in its name, skipping lists ("List of …")
 * and articles named by a later part of the query (the platform: "Game Boy Color").
 */
export function pickWikipediaImage(pages: readonly WikiPage[], query: string): ImageResult | null {
  const asked = words(wikipediaSearchText(query));
  const first = asked.split(" ").find((word) => word.length > 1 && !STOP.has(word)) ?? "";
  const hits = pages
    .map((page) => ({ page, picture: page.original?.source ? page.original : page.thumbnail }))
    .map((hit) => ({ ...hit, url: https(hit.picture?.source ?? null, "https://en.wikipedia.org/"), name: words((hit.page.title ?? "").replace(/\s*\([^)]*\)\s*$/, "")) }))
    .filter((hit) => hit.url && !/\.svg(\?|$)/i.test(hit.url) && !/^list of\b/i.test(hit.page.title ?? ""))
    .sort((a, b) => (a.page.index ?? 99) - (b.page.index ?? 99));
  const starts = hits.slice(0, 3).filter((hit) => hit.name && (asked === hit.name || asked.startsWith(`${hit.name} `))).sort((a, b) => b.name.length - a.name.length);
  const best = starts[0] ?? hits.find((hit) => ` ${hit.name} `.includes(` ${first} `) && !(` ${asked} `.includes(` ${hit.name} `) && !asked.startsWith(hit.name)));
  if (!best) return null;
  const { page, picture } = best;
  return { url: best.url!, alt: page.title ?? query, source: page.fullurl ?? `https://en.wikipedia.org/wiki/${encodeURIComponent((page.title ?? "").replace(/ /g, "_"))}`, ...(picture?.width ? { width: picture.width } : {}), ...(picture?.height ? { height: picture.height } : {}) };
}

async function wikipediaSearch(search: string, query: string, deps: Pick<ImageDeps, "lookup" | "transport">): Promise<ImageResult | null> {
  const params = new URLSearchParams({
    action: "query", format: "json", formatversion: "2", redirects: "1",
    generator: "search", gsrsearch: search, gsrlimit: "5", gsrnamespace: "0",
    prop: "pageimages|info", piprop: "original|thumbnail", pithumbsize: "1200", pilicense: "any", inprop: "url",
  });
  const page = await safeFetch(`${WIKIPEDIA_API_URL}?${params}`, deps);
  let payload: { query?: { pages?: WikiPage[] } };
  try { payload = JSON.parse(page.text); } catch { throw new Error("Wikipedia's answer couldn't be read."); }
  return pickWikipediaImage(payload.query?.pages ?? [], query);
}

/**
 * A picture from Wikipedia for a query: its search API, then the best hit's page image (any licence, so box art
 * counts). When no hit is about the thing, once more with just its name (the words before a platform, else the
 * first three).
 */
export async function wikipediaImage(query: string, deps: Pick<ImageDeps, "lookup" | "transport"> = {}): Promise<ImageResult | null> {
  const search = wikipediaSearchText(query);
  const found = await wikipediaSearch(search, query, deps);
  if (found) return found;
  const cut = PLATFORM.exec(search)?.index ?? -1;
  const name = (cut > 0 ? search.slice(0, cut) : search.split(" ").slice(0, 3).join(" ")).trim();
  return name && name !== search ? wikipediaSearch(name, name, deps) : null;
}

/** Runs one Exa search for a query: its best picture, or null. */
async function exaImage(query: string, key: string, deps: ImageDeps): Promise<ImageResult | null> {
  const doFetch = deps.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await doFetch(EXA_SEARCH_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify({ query, numResults: 6, contents: { extras: { imageLinks: 6 } } }),
    });
    if (!response.ok) throw new Error(`Image search failed (${response.status}).`);
    const payload = (await response.json()) as { results?: ExaResult[] };
    return pickExaImage(payload.results ?? [], query);
  } finally {
    clearTimeout(timer);
  }
}

const queryKey = (query: string) => `q:${query.toLowerCase().replace(/\s+/g, " ").trim()}`;
const pageKey = (pageUrl: string) => `u:${pageUrl.trim()}`;

/**
 * Runs canvas_image: Exa for a query when a key is set, then the page's main picture when pageUrl is given, then
 * Wikipedia for the query. Answers are cached by query and by address. Errors are redacted of the key.
 */
export async function findImage(input: { query?: string; pageUrl?: string }, deps: ImageDeps, key?: string): Promise<ImageResult> {
  key ??= await deps.exaKey();
  const redact = (error: unknown) => {
    const text = error instanceof Error ? error.message : String(error);
    return new Error(key ? text.split(key).join("[key]") : text);
  };
  const query = input.query?.trim() || "";
  const pageUrl = input.pageUrl?.trim() || "";
  const cached = (query && deps.cache?.get(queryKey(query))) || (pageUrl && deps.cache?.get(pageKey(pageUrl))) || null;
  if (cached) return cached;
  const keep = (image: ImageResult) => {
    if (query) deps.cache?.set(queryKey(query), image);
    if (pageUrl) deps.cache?.set(pageKey(pageUrl), image);
    return image;
  };
  const failures: string[] = [];
  const attempt = async (find: () => Promise<ImageResult | null>) => {
    try { return await find(); } catch (error) { failures.push(redact(error).message); return null; }
  };
  if (!query && !pageUrl) throw new Error("Say what to find (query) or which page to take the picture from (pageUrl).");
  if (key && query) { const image = await attempt(() => exaImage(query, key!, deps)); if (image) return keep(image); }
  if (pageUrl) {
    const image = await attempt(async () => { const page = await safeFetch(pageUrl, deps); return mainImage(page.text, page.url); });
    if (image) return keep(image);
    if (!failures.length) failures.push("That page has no main image.");
  }
  if (query) { const image = await attempt(() => wikipediaImage(query, deps)); if (image) return keep(image); }
  const why = failures.length ? ` (${failures.join("; ")})` : "";
  throw new Error(query ? `No picture found for "${query}"${why}. Try the thing's exact name, or pass pageUrl (a store, publisher or Wikipedia page about it).` : `No picture on that page${why}. Try another page about it (a store, publisher or Wikipedia page).`);
}

export interface ImageRequest { key: string; query?: string; pageUrl?: string }
export type ImageAnswer = ImageResult | { error: string };

/** Runs canvas_images: every request at once (a few at a time), each answer under its key; one failure doesn't stop the rest. */
export async function findImages(items: readonly ImageRequest[], deps: ImageDeps): Promise<Record<string, ImageAnswer>> {
  const key = await deps.exaKey();
  const answers: Record<string, ImageAnswer> = {};
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]!;
      try { answers[item.key] = await findImage(item, deps, key); } catch (error) { answers[item.key] = { error: error instanceof Error ? error.message : String(error) }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(IMAGE_PARALLEL, items.length) }, worker));
  // In the order asked.
  return Object.fromEntries(items.map((item) => [item.key, answers[item.key]!]));
}

/**
 * Found pictures, kept for a day: in memory, and in the plugin's database (canvas_image_cache) so they last
 * across restarts. Only answers are kept, never failures, so a picture that wasn't found is looked up again.
 */
export class ImageCache implements ImageCacheLike {
  private readonly memory = new Map<string, { at: number; image: ImageResult }>();
  constructor(private readonly db: Database.Database | null, private readonly now: () => number = Date.now, private readonly ttl = IMAGE_CACHE_MS) {}
  get(key: string): ImageResult | null {
    const at = this.now();
    let hit = this.memory.get(key);
    if (!hit && this.db) {
      const row = this.db.prepare("SELECT image, at FROM canvas_image_cache WHERE key = ?").get(key) as { image: string; at: number } | undefined;
      if (row) { try { hit = { at: row.at, image: JSON.parse(row.image) as ImageResult }; this.memory.set(key, hit); } catch { /* a bad row is looked up again */ } }
    }
    if (!hit) return null;
    if (at - hit.at > this.ttl) { this.memory.delete(key); return null; }
    return hit.image;
  }
  set(key: string, image: ImageResult): void {
    const at = this.now();
    this.memory.set(key, { at, image });
    if (this.memory.size > 2000) this.memory.delete(this.memory.keys().next().value!);
    if (!this.db) return;
    this.db.prepare("INSERT INTO canvas_image_cache (key, image, at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET image = excluded.image, at = excluded.at").run(key, JSON.stringify(image), at);
    this.db.prepare("DELETE FROM canvas_image_cache WHERE at < ?").run(at - this.ttl);
  }
}
