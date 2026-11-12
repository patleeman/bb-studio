// Link previews for bookmark embeds: fetch a public page and read its title,
// description and preview image from the <head>. Every hop goes through the
// guarded fetch (src/guarded-fetch.ts): a link on this machine or a
// private network has no preview, even through a redirect.
import { guardedFetch, type GuardOptions } from "../guarded-fetch";

export interface LinkPreview {
  title: string;
  description: string;
  image: string;
}

const TIMEOUT_MS = 6000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 4;

const LOCAL = "Local links have no preview.";

function assertNotLocalName(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http and https links have previews.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new Error(LOCAL);
}

async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    // The <head> is all we need.
    if (new TextDecoder().decode(value).includes("</head>")) break;
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function fetchPreview(target: string, deps: Pick<GuardOptions, "resolve" | "transport"> = {}): Promise<LinkPreview> {
  let url = new URL(target);
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    assertNotLocalName(url);
    const response = await guardedFetch(url, {
      method: "GET",
      body: null,
      signal,
      headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 (compatible; BB Pages link preview)" },
    }, { ...deps, refuse: () => LOCAL });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel().catch(() => {});
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) throw new Error(`The link returned ${response.status}.`);
    if (!/html/i.test(response.headers.get("content-type") ?? "")) return { title: "", description: "", image: "" };
    return parsePreview(await readCapped(response), url);
  }
  throw new Error("The link redirects too many times.");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decode(text: string): string {
  return text
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
      if (entity[0] === "#") {
        const code = entity[1] === "x" || entity[1] === "X" ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[entity.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return match ? (match[2] ?? match[3] ?? match[4] ?? "") : null;
}

/** Reads the preview from a page's HTML; `base` resolves a relative image. */
export function parsePreview(html: string, base: URL): LinkPreview {
  const end = html.search(/<\/head>/i);
  const head = end === -1 ? html : html.slice(0, end);
  const meta = new Map<string, string>();
  for (const [tag] of head.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attribute(tag, "property") ?? attribute(tag, "name"))?.toLowerCase();
    const content = attribute(tag, "content");
    if (key && content && !meta.has(key)) meta.set(key, decode(content));
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  const pick = (...keys: string[]) => keys.map((key) => meta.get(key)).find(Boolean) ?? "";
  let image = pick("og:image", "og:image:url", "twitter:image", "twitter:image:src");
  try {
    image = image ? new URL(image, base).toString() : "";
    if (!/^https?:/.test(image)) image = "";
  } catch {
    image = "";
  }
  return {
    title: (pick("og:title", "twitter:title") || decode(titleTag ?? "")).slice(0, 300),
    description: pick("og:description", "twitter:description", "description").slice(0, 500),
    image: image.slice(0, 2000),
  };
}
