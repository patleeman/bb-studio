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
// safeFetch: http(s) only, no private, loopback or link-local addresses
// (checked again on every redirect), a time limit and a size cap.
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface ImageResult { url: string; alt: string; source: string; width?: number; height?: number }
export interface ImageDeps {
  /** The Exa key, or "" when none is set. */
  exaKey(): Promise<string>;
  fetch?: typeof fetch;
  lookup?: (host: string) => Promise<{ address: string }[]>;
}

export const EXA_SEARCH_URL = "https://api.exa.ai/search";
const PAGE_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

/** Addresses a server-side fetch must never reach: private, loopback, link-local, carrier NAT, multicast, unspecified. */
export function privateAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) {
    const [a, b] = address.split(".").map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (v === 6) {
    const s = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return privateAddress(mapped[1]!);
    return s === "::" || s === "::1" || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s);
  }
  return true;
}

/** A GET of a public http(s) page: every hop's host resolved and checked, at most 3 redirects, a time limit and a size cap. */
export async function safeFetch(url: string, deps: Pick<ImageDeps, "fetch" | "lookup"> = {}): Promise<{ url: string; text: string; type: string }> {
  const doFetch = deps.fetch ?? fetch;
  const resolve = deps.lookup ?? ((host: string) => dnsLookup(host, { all: true }));
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
      const response = await doFetch(parsed.toString(), { redirect: "manual", signal: controller.signal, headers: { "user-agent": "Mozilla/5.0 (BB Studio Canvas image finder)", accept: "text/html,application/xhtml+xml" } });
      if (response.status >= 300 && response.status < 400) {
        const next = response.headers.get("location");
        if (!next) throw new Error("A redirect with nowhere to go.");
        current = new URL(next, parsed).toString();
        continue;
      }
      if (!response.ok) throw new Error(`The page answered ${response.status}.`);
      const reader = response.body?.getReader();
      let text = "";
      if (reader) {
        const decoder = new TextDecoder();
        let bytes = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          text += decoder.decode(value, { stream: true });
          if (bytes > PAGE_BYTES) { await reader.cancel().catch(() => {}); break; }
        }
      } else text = (await response.text()).slice(0, PAGE_BYTES);
      return { url: parsed.toString(), text, type: response.headers.get("content-type") ?? "" };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Too many redirects.");
}

const attr = (tag: string, name: string) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag)?.slice(1).find((v) => v !== undefined) ?? null;
const decode = (text: string) => text.replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const https = (raw: string | null, base: string): string | null => {
  if (!raw) return null;
  try {
    const url = new URL(decode(raw.trim()), base);
    if (url.protocol === "http:") url.protocol = "https:"; // the frame loads https only; most hosts serve both
    return url.protocol === "https:" ? url.toString() : null;
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
