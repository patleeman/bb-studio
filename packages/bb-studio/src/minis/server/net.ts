// `playground.fetch`: a mini app's requests, made by Studio's server for it.
//
// Only to hosts the manifest lists as `fetch:<host>` and the user approved;
// never to this machine or a private network, and connected to the address
// that was checked (src/guarded-fetch.ts); redirects are followed
// by hand and each hop is checked again. Cookies never go out. A secret the
// user stored for the app goes into the header it names, and the app never
// sees the value. It goes only over https, only to the hosts the app could
// reach when the user stored it, and is dropped when a redirect leaves the
// request's origin. Every request lands in the app's network log.
import { guardedFetch, type Resolve, type Transport } from "../../guarded-fetch";
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

export interface StoredSecret {
  header: string;
  value: string;
  /** The `fetch:` hosts it may go to; null for one stored before secrets were tied to hosts. */
  hosts: string[] | null;
}

export interface NetDeps {
  granted: readonly string[];
  secret(name: string): StoredSecret | null;
  transport?: Transport;
  resolve?: Resolve;
}

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);
const BLOCKED_HEADERS = /^(?:cookie|cookie2|host|origin|referer|connection|content-length|transfer-encoding|proxy-.*|sec-.*|x-forwarded-.*|x-bb-.*)$/i;
const RESPONSE_HEADERS = new Set(["content-type", "content-language", "etag", "last-modified", "cache-control", "link", "location", "retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "x-total-count"]);
const MAX_REDIRECTS = 5;

function checkUrl(raw: string, deps: NetDeps): URL {
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
  return url;
}

const refuse = (host: string) => `${host} is on this machine or a private network; mini apps can't reach it.`;

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
  if (input.body !== null && Buffer.byteLength(input.body) > LIMITS.fetchBytes) throw new Error("The request body is too large.");

  let url = checkUrl(input.url, deps);
  // The secret's header, while the request stays on the origin it was sent to.
  let secretHeader: string | null = null;
  if (input.auth) {
    if (!deps.granted.includes(`secret:${input.auth}`)) throw new Error(`needs approval: add "secret:${input.auth}" to the capabilities, and the user approves it and stores the secret.`);
    const secret = deps.secret(input.auth);
    if (!secret) throw new Error(`No secret "${input.auth}" is stored for this mini app yet. The user adds it in the mini app's Settings.`);
    if (secret.hosts === null) throw new Error(`Store the secret "${input.auth}" again in the mini app's Settings: a secret now goes only to the hosts the app may reach when it's stored.`);
    if (url.protocol !== "https:") throw new Error(`The secret "${input.auth}" is sent only over https.`);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (!hostAllowed(host, secret.hosts.map((each) => `fetch:${each}`))) {
      throw new Error(`The secret "${input.auth}" is only sent to ${secret.hosts.join(", ") || "no host"}. To send it to ${host}, store it again in the mini app's Settings once ${host} is approved.`);
    }
    // The app can't override it: a header of the same name, in any case, is dropped.
    for (const key of Object.keys(headers)) if (key.toLowerCase() === secret.header.toLowerCase()) delete headers[key];
    headers[secret.header] = secret.value;
    secretHeader = secret.header;
  }

  let currentMethod = method;
  let body = method === "GET" || method === "HEAD" ? null : input.body;
  for (let hop = 0; ; hop++) {
    const response = await guardedFetch(url, {
      method: currentMethod,
      headers: { ...headers },
      body,
      signal: AbortSignal.timeout(LIMITS.fetchTimeoutMs),
    }, { transport: deps.transport, resolve: deps.resolve, refuse });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      if (hop >= MAX_REDIRECTS) throw new Error("Too many redirects.");
      await response.body?.cancel();
      const next = new URL(location, url);
      // Leaving the origin (scheme, host or port) drops the secret, as browsers drop credentials.
      if (secretHeader && next.origin !== url.origin) {
        delete headers[secretHeader];
        secretHeader = null;
      }
      url = checkUrl(next.toString(), deps);
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
