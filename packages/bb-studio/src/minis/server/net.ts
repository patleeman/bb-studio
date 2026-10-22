// `playground.fetch`: a mini app's requests, made by Studio's server for it.
//
// Only to hosts the manifest lists as `fetch:<host>` and the user approved;
// never to this machine or a private network; redirects are followed by hand
// and each hop is checked again. Cookies never go out. A secret the user
// stored for the app goes into the header it names, and the app never sees
// the value. Every request lands in the app's network log.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { hostAllowed, LIMITS } from "../shared";

export interface FetchInput {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  /** A stored secret's name, for its header. */
  auth: string | null;
}

export interface FetchOutput {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  url: string;
}

export interface NetDeps {
  granted: readonly string[];
  secret(name: string): { header: string; value: string } | null;
  fetch?: typeof fetch;
  resolve?: (host: string) => Promise<string[]>;
}

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);
const BLOCKED_HEADERS = /^(?:cookie|cookie2|host|origin|referer|connection|content-length|transfer-encoding|proxy-.*|sec-.*|x-forwarded-.*|x-bb-.*)$/i;
const RESPONSE_HEADERS = new Set(["content-type", "content-language", "etag", "last-modified", "cache-control", "link", "location", "retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "x-total-count"]);
const MAX_REDIRECTS = 5;

/** Loopback, private, link-local, CGNAT, multicast and unspecified addresses. */
export function isPrivateAddress(address: string): boolean {
  const lower = address.toLowerCase();
  if (isIP(lower) === 6) {
    if (lower === "::" || lower === "::1") return true;
    if (lower.startsWith("::ffff:")) return isPrivateAddress(lower.slice(7));
    return /^(?:fc|fd|fe8|fe9|fea|feb|ff)/.test(lower);
  }
  const parts = lower.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

async function defaultResolve(host: string): Promise<string[]> {
  return (await lookup(host, { all: true })).map((entry) => entry.address);
}

async function checkUrl(raw: string, deps: NetDeps): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Not a URL: ${raw}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http and https URLs can be fetched.");
  if (url.username || url.password) throw new Error("URLs with a user name or password aren't allowed; store a secret instead.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!hostAllowed(host, deps.granted)) throw new Error(`needs approval: this mini app may not reach ${host}. Add "fetch:${host}" to its capabilities, and the user approves it.`);
  const addresses = isIP(host) ? [host] : await (deps.resolve ?? defaultResolve)(host);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw new Error(`${host} is on this machine or a private network; mini apps can't reach it.`);
  return url;
}

async function readCapped(response: Response): Promise<{ text: string; bytes: number }> {
  const reader = response.body?.getReader();
  if (!reader) return { text: "", bytes: 0 };
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > LIMITS.fetchBytes) {
      await reader.cancel();
      throw new Error(`The response is over ${LIMITS.fetchBytes / 1024 / 1024} MB.`);
    }
    chunks.push(value);
  }
  return { text: new TextDecoder().decode(Buffer.concat(chunks)), bytes };
}

/** Makes the request; throws with a message the app can show. */
export async function proxyFetch(input: FetchInput, deps: NetDeps): Promise<FetchOutput & { bytes: number }> {
  const method = input.method.toUpperCase();
  if (!METHODS.has(method)) throw new Error(`Method ${input.method} isn't allowed.`);
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.headers)) {
    if (BLOCKED_HEADERS.test(key)) continue;
    if (/[\r\n]/.test(key) || /[\r\n]/.test(String(value))) throw new Error("Header names and values can't contain line breaks.");
    headers[key] = String(value);
  }
  if (input.auth) {
    if (!deps.granted.includes(`secret:${input.auth}`)) throw new Error(`needs approval: add "secret:${input.auth}" to the capabilities, and the user approves it and stores the secret.`);
    const secret = deps.secret(input.auth);
    if (!secret) throw new Error(`No secret "${input.auth}" is stored for this mini app yet. The user adds it in the mini app's Settings.`);
    headers[secret.header] = secret.value;
  }
  if (input.body !== null && Buffer.byteLength(input.body) > LIMITS.fetchBytes) throw new Error("The request body is too large.");

  const doFetch = deps.fetch ?? fetch;
  let url = await checkUrl(input.url, deps);
  let currentMethod = method;
  let body = method === "GET" || method === "HEAD" ? null : input.body;
  for (let hop = 0; ; hop++) {
    const response = await doFetch(url.toString(), {
      method: currentMethod,
      headers: { ...headers },
      body,
      redirect: "manual",
      credentials: "omit",
      signal: AbortSignal.timeout(LIMITS.fetchTimeoutMs),
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      if (hop >= MAX_REDIRECTS) throw new Error("Too many redirects.");
      await response.body?.cancel();
      const next = new URL(location, url);
      // A redirect to another host drops the secret, as browsers drop credentials.
      if (next.host !== url.host && input.auth) delete headers[deps.secret(input.auth)?.header ?? ""];
      url = await checkUrl(next.toString(), deps);
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && currentMethod === "POST")) {
        currentMethod = "GET";
        body = null;
      }
      continue;
    }
    const { text, bytes } = await readCapped(response);
    const out: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      if (RESPONSE_HEADERS.has(key.toLowerCase())) out[key.toLowerCase()] = value;
    });
    return { status: response.status, statusText: response.statusText, headers: out, body: text, url: url.toString(), bytes };
  }
}

/** A sliding one-minute window per key, for writes and fetches. */
export class RateLimit {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly perMinute: number, private readonly now: () => number = Date.now) {}

  take(key: string, what: string) {
    const at = this.now();
    const recent = (this.hits.get(key) ?? []).filter((time) => at - time < 60_000);
    if (recent.length >= this.perMinute) throw new Error(`Too many ${what}: at most ${this.perMinute} a minute.`);
    recent.push(at);
    this.hits.set(key, recent);
  }
}
