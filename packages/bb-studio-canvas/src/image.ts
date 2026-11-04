// canvas_image: a picture for the page (box art, a product shot, a photo)
// as an https address the page's frame may load.
//
// - With an Exa API key (the plugin's exaApiKey secret setting): Exa search
//   with contents; each result's image and its page's image links (with alt
//   text) are candidates, and the best match for the query wins.
// - Without one: given pageUrl, the page is fetched here on the server and
//   its main image is taken (og:image, twitter:image, else the largest
//   image in it).
//
// The key never leaves this module: it isn't logged, returned or put in an
// error (errors are redacted). Every fetch of a page goes through
// safeFetch: http(s) only; each hop's host resolved once, every address
// checked (no private, loopback, link-local, CGNAT, multicast, ULA or
// mapped addresses) and the connection pinned to that exact address, so a
// resolver can't change its answer between the check and the connect;
// again on every redirect; a time limit and a size cap. Image addresses
// lose their tracking parameters.
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

export interface ImageResult { url: string; alt: string; source: string; width?: number; height?: number }
export interface ImageDeps {
  /** The Exa key, or "" when none is set. */
  exaKey(): Promise<string>;
  /** For Exa's API (a fixed public host). */
  fetch?: typeof fetch;
  lookup?: (host: string) => Promise<{ address: string }[]>;
  /** How a checked page is fetched (pinnedTransport by default). */
  transport?: Transport;
}

export const EXA_SEARCH_URL = "https://api.exa.ai/search";
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
export interface Exchange { status: number; location: string | null; type: string; body: AsyncIterable<Uint8Array> | null; close(): void }
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
    headers: { "user-agent": "Mozilla/5.0 (BB Studio Canvas image finder)", accept: "text/html,application/xhtml+xml" },
  }, (response) => {
    resolve({
      status: response.statusCode ?? 0,
      location: typeof response.headers.location === "string" ? response.headers.location : null,
      type: String(response.headers["content-type"] ?? ""),
      body: response,
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
export async function safeFetch(url: string, deps: Pick<ImageDeps, "lookup" | "transport"> = {}): Promise<{ url: string; text: string; type: string }> {
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
      return { url: parsed.toString(), text, type: response.type };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Too many redirects.");
}

/** Tracking parameters an image address doesn't need (and shouldn't carry to the page). */
const TRACKING = /^(utm_.*|fbclid|gclid|dclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid|_hsenc|_hsmi|ref_src|yclid|oly_.*|vero_.*)$/i;
export function stripTracking(raw: string): string {
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
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

/** Runs canvas_image. Errors are redacted of the key. */
export async function findImage(input: { query?: string; pageUrl?: string }, deps: ImageDeps): Promise<ImageResult> {
  const key = await deps.exaKey();
  const redact = (error: unknown) => {
    const text = error instanceof Error ? error.message : String(error);
    return new Error(key ? text.split(key).join("[key]") : text);
  };
  try {
    if (key && input.query) {
      const doFetch = deps.fetch ?? fetch;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const response = await doFetch(EXA_SEARCH_URL, {
          method: "POST",
          signal: controller.signal,
          headers: { "content-type": "application/json", "x-api-key": key },
          body: JSON.stringify({ query: input.query, numResults: 6, contents: { extras: { imageLinks: 6 } } }),
        });
        if (!response.ok) throw new Error(`Image search failed (${response.status}).`);
        const payload = (await response.json()) as { results?: ExaResult[] };
        const image = pickExaImage(payload.results ?? [], input.query);
        if (image) return image;
        if (!input.pageUrl) throw new Error(`No picture found for "${input.query}". Try other words, or pass pageUrl.`);
      } finally {
        clearTimeout(timer);
      }
    }
    if (input.pageUrl) {
      const page = await safeFetch(input.pageUrl, deps);
      const image = mainImage(page.text, page.url);
      if (!image) throw new Error("That page has no main image. Try another page about it (a store, publisher or Wikipedia page).");
      return image;
    }
    throw new Error(key ? "Say what to find (query) or which page to take the picture from (pageUrl)." : "No image search key is set. Pass pageUrl (a store, publisher or Wikipedia page about it) and I'll take that page's main image.");
  } catch (error) {
    throw redact(error);
  }
}
