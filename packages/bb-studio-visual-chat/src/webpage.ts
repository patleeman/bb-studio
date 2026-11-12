// Webpage parts (data-embed="page" data-url="https://…"): a page the user gave or the agent read, shown on
// the board. Two checks, both here on the server:
//
// - Provenance. A URL is shown only when it came from the user in this chat, or from the agent's own
//   web fetch or web search results in the turn that put it on the board (the thread's event log). A link
//   that only appears inside a fetched page's text doesn't count: that's where a prompt injection would
//   plant one. Anything else shows as "link not verified". A URL verified once stays verified for the chat,
//   so a later version that keeps the part keeps showing it.
// - Framing. One GET (safeFetch: public addresses only, pinned, at most 3 redirects, size and time capped)
//   gives the page's X-Frame-Options and CSP frame-ancestors, and its OpenGraph data. A page that allows
//   framing is framed over its placeholder; one that doesn't gets a link card. Cached for a day.
//
// Nothing here reads the page back to the agent, and nothing opens it: the board's Open button does, when
// the user clicks it (BB's browser beside the board on desktop, else the external browser).
import type Database from "better-sqlite3";
import { safeFetch, TRACKING_PARAM, type ImageDeps } from "./image";

export const WEBPAGE_CACHE_MS = 24 * 60 * 60 * 1000;
const URL_MAX = 2000;

/** A URL as compared for provenance: no scheme (http and https match), host without www., no fragment, no tracking parameters, no trailing slash. */
export function normalizeUrl(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return null;
  for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  const port = url.port && url.port !== "443" && url.port !== "80" ? `:${url.port}` : "";
  const path = url.pathname.replace(/\/+$/, "");
  const query = url.searchParams.toString();
  return `${host}${port}${path}${query ? `?${query}` : ""}`;
}

/** The https(s) URLs written in a text (a message, a search result list), trimmed of trailing punctuation and unbalanced brackets. */
export function urlsIn(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`\\\]{}|^]+/gi)) {
    let url = match[0].replace(/[.,;:!?*]+$/, "");
    while (url.endsWith(")") && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) url = url.slice(0, -1).replace(/[.,;:!?*]+$/, "");
    if (url.length <= URL_MAX) out.push(url);
  }
  return out;
}

/** The webpage parts' URLs in a page's HTML (data-embed="page" with data-url), as written. */
export function pageUrlsIn(html: string): string[] {
  const out = new Set<string>();
  for (const tag of html.match(/<[a-z][^>]*\bdata-embed\s*=\s*(["'])page\1[^>]*>/gi) ?? []) {
    const url = /\bdata-url\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    const value = (url?.[1] ?? url?.[2] ?? "").replace(/&amp;/g, "&").trim();
    if (value) out.add(value);
  }
  return [...out];
}

/** A completed item from the thread's event log, as far as provenance reads it (BB's webSearch and webFetch items). */
export interface TurnItem { type?: string; url?: unknown; resultText?: unknown; queries?: unknown }
export type Provenance = "user" | "fetched" | "searched";

/** Where a URL came from, or null: the user's messages, a page the agent fetched this turn, or a result of its searches this turn. */
export function provenanceOf(url: string, userTexts: readonly string[], items: readonly TurnItem[]): Provenance | null {
  const key = normalizeUrl(url);
  if (!key) return null;
  const has = (urls: readonly string[]) => urls.some((each) => normalizeUrl(each) === key);
  if (has(userTexts.flatMap(urlsIn))) return "user";
  if (has(items.filter((item) => item.type === "webFetch" && typeof item.url === "string").map((item) => item.url as string))) return "fetched";
  if (has(items.filter((item) => item.type === "webSearch" && typeof item.resultText === "string").flatMap((item) => urlsIn(item.resultText as string)))) return "searched";
  return null;
}

/** A URL a webpage part may show at all: https, a public-looking host name (no IP, no localhost, no single label), no credentials. */
export function webpageUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > URL_MAX) return null;
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || /^[\d.]+$/.test(host) || host.includes(":")) return null;
  return url.toString();
}

/** Whether a page's response headers let another site frame it: no X-Frame-Options, and frame-ancestors (if any) open to every https site. */
export function framingAllowed(headers: Record<string, string | string[] | undefined>): boolean {
  const get = (name: string) => { const value = headers[name]; return Array.isArray(value) ? value.join(",") : value ?? ""; };
  if (get("x-frame-options").trim()) return false;
  for (const policy of get("content-security-policy").split(",")) {
    const directive = policy.split(";").map((part) => part.trim()).find((part) => /^frame-ancestors\b/i.test(part));
    if (!directive) continue;
    const sources = directive.split(/\s+/).slice(1).map((source) => source.toLowerCase());
    if (!sources.some((source) => source === "*" || source === "https:")) return false;
  }
  return true;
}

export interface WebpageCard { title: string; site: string; summary: string | null; image: string | null }
export interface WebpageInfo { url: string; framable: boolean; card: WebpageCard }

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (text: string) => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
  if (code[0] === "#") { const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ""; }
  return ENTITIES[code.toLowerCase()] ?? whole;
});
const attr = (tag: string, name: string) => { const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag); return m ? decode(m[1] ?? m[2] ?? "") : null; };
const clean = (text: string | null, max: number) => { const t = (text ?? "").replace(/\s+/g, " ").trim(); return t ? (t.length > max ? `${t.slice(0, max - 1)}…` : t) : null; };

/** A link card from a page's HTML: OpenGraph (and Twitter) title, site, summary and https image, else its <title> and description. */
export function readCard(html: string, pageUrl: string): WebpageCard {
  const head = html.slice(0, 300_000);
  const metas = head.match(/<meta\b[^>]*>/gi) ?? [];
  const meta = (...keys: string[]) => { for (const key of keys) { const tag = metas.find((each) => (attr(each, "property") ?? attr(each, "name"))?.toLowerCase() === key); const content = tag ? attr(tag, "content") : null; if (content?.trim()) return content; } return null; };
  const host = new URL(pageUrl).hostname.replace(/^www\./, "");
  const title = clean(meta("og:title", "twitter:title") ?? decode(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? ""), 160) ?? host;
  let image: string | null = null;
  const raw = meta("og:image:secure_url", "og:image", "twitter:image", "twitter:image:src");
  if (raw) { try { const u = new URL(raw, pageUrl); if (u.protocol === "https:") image = u.toString(); } catch { /* no picture */ } }
  return { title, site: clean(meta("og:site_name", "application-name"), 60) ?? host, summary: clean(meta("og:description", "twitter:description", "description"), 280), image };
}

/** Looks a page up once: whether it can be framed, and its card. A page that can't be read is a plain card (its host), never framed. */
export async function checkWebpage(url: string, deps: Pick<ImageDeps, "lookup" | "transport"> = {}): Promise<WebpageInfo> {
  const host = new URL(url).hostname.replace(/^www\./, "");
  try {
    const page = await safeFetch(url, deps);
    const html = /html|xml/i.test(page.type) ? page.text : "";
    // The frame follows the same redirects, so the final page's headers decide; it must still be https.
    const framable = page.url.startsWith("https:") && /html/i.test(page.type) && framingAllowed(page.headers ?? {});
    return { url, framable, card: html ? readCard(html, page.url) : { title: host, site: host, summary: null, image: null } };
  } catch {
    return { url, framable: false, card: { title: host, site: host, summary: null, image: null } };
  }
}

/** Looked-up pages, a day each, in memory and in the plugin's database (canvas_webpage_cache). Only answers that read the page are kept. */
export class WebpageCache {
  private readonly memory = new Map<string, { at: number; info: WebpageInfo }>();
  constructor(private readonly db: Database.Database | null, private readonly now: () => number = Date.now, private readonly ttl = WEBPAGE_CACHE_MS) {}
  get(url: string): WebpageInfo | null {
    const at = this.now();
    let hit = this.memory.get(url);
    if (!hit && this.db) {
      const row = this.db.prepare("SELECT data, at FROM canvas_webpage_cache WHERE url = ?").get(url) as { data: string; at: number } | undefined;
      if (row) { try { hit = { at: row.at, info: JSON.parse(row.data) as WebpageInfo }; this.memory.set(url, hit); } catch { /* looked up again */ } }
    }
    if (!hit || at - hit.at > this.ttl) { if (hit) this.memory.delete(url); return null; }
    return hit.info;
  }
  set(url: string, info: WebpageInfo): void {
    const at = this.now();
    this.memory.set(url, { at, info });
    if (this.memory.size > 500) this.memory.delete(this.memory.keys().next().value!);
    if (!this.db) return;
    this.db.prepare("INSERT INTO canvas_webpage_cache (url, data, at) VALUES (?, ?, ?) ON CONFLICT(url) DO UPDATE SET data = excluded.data, at = excluded.at").run(url, JSON.stringify(info), at);
    this.db.prepare("DELETE FROM canvas_webpage_cache WHERE at < ?").run(at - this.ttl);
  }
}

/** A page's card and framing, from the cache or looked up (and cached when the page could be read). */
export async function webpageInfo(url: string, cache: WebpageCache, deps: Pick<ImageDeps, "lookup" | "transport"> = {}): Promise<WebpageInfo> {
  const hit = cache.get(url);
  if (hit) return hit;
  const info = await checkWebpage(url, deps);
  if (info.framable || info.card.summary || info.card.image || info.card.title !== new URL(url).hostname.replace(/^www\./, "")) cache.set(url, info);
  return info;
}
