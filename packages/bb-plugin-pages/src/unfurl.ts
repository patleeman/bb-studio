// Link previews for bookmark embeds: fetch a public page and read its title,
// description and preview image from the <head>.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface LinkPreview {
  title: string;
  description: string;
  image: string;
}

const TIMEOUT_MS = 6000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 4;

/** Loopback, private, link-local and other non-public addresses. */
export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    if (lower.startsWith("::ffff:")) return isPrivateAddress(lower.slice(7));
    return lower === "::" || lower === "::1" || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
  }
  const parts = address.split(".").map(Number);
  if (parts.length !== 4) return true;
  const [a, b] = parts as [number, number, number, number];
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || a >= 224;
}

async function assertPublic(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http and https links have previews.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new Error("Local links have no preview.");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((entry) => entry.address);
  if (!addresses.length || addresses.some(isPrivateAddress)) throw new Error("Local links have no preview.");
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

export async function fetchPreview(target: string): Promise<LinkPreview> {
  let url = new URL(target);
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublic(url);
    const response = await fetch(url, {
      redirect: "manual",
      signal,
      headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Mozilla/5.0 (compatible; BB Pages link preview)" },
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
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
