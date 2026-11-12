// One request to a public address, for every URL Studio's server fetches on
// someone else's behalf: a mini app's `playground.fetch`, a page's link
// preview, a dashboard's url source.
//
// The host is resolved once, every address it resolves to must be public
// (not this machine, a private network, link-local or cloud metadata), and
// the connection goes to those checked addresses: DNS isn't asked again, so
// a second answer can't point the request somewhere else (DNS rebinding).
// The Host header and the TLS server name stay the URL's host name.
//
// Redirects aren't followed: callers follow them by hand and call this again
// for each hop, so every hop is checked the same way.
import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { pipeline, Readable } from "node:stream";
import { createBrotliDecompress, createGunzip } from "node:zlib";

export interface HopInit {
  method: string;
  headers: Record<string, string>;
  body: string | null;
  signal?: AbortSignal;
}

/** The addresses a host name resolves to. */
export type Resolve = (host: string) => Promise<string[]>;
/** Makes one request, connecting only to `addresses` (already checked). */
export type Transport = (url: URL, init: HopInit, addresses: readonly string[]) => Promise<Response>;

export interface GuardOptions {
  resolve?: Resolve;
  /** Replaces the pinned connection; tests use it. */
  transport?: Transport;
  /** The refusal's message, for a host that isn't public. */
  refuse?: (host: string) => string;
}

export class PrivateAddressError extends Error {}

/** Loopback, private, link-local (cloud metadata), CGNAT, multicast and unspecified addresses, and anything that isn't an IP address. */
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

const defaultResolve: Resolve = async (host) => (await lookup(host, { all: true })).map((entry) => entry.address);

const hostOf = (url: URL) => url.hostname.replace(/^\[|\]$/g, "");

/** `url`'s host, resolved and checked: every address public, or it throws. */
export async function publicAddresses(url: URL, options: Pick<GuardOptions, "resolve" | "refuse"> = {}): Promise<string[]> {
  const host = hostOf(url);
  const addresses = isIP(host) ? [host] : await (options.resolve ?? defaultResolve)(host);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new PrivateAddressError(options.refuse?.(host) ?? `${host} is on this machine or a private network, so Studio won't fetch it.`);
  }
  return addresses;
}

/** One http(s) request to a public address. Doesn't follow redirects. */
export async function guardedFetch(url: URL, init: HopInit, options: GuardOptions = {}): Promise<Response> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`Only http and https URLs can be fetched, not ${url.protocol.replace(/:$/, "")}.`);
  const addresses = await publicAddresses(url, options);
  return (options.transport ?? pinnedTransport)(url, init, addresses);
}

const NULL_BODY = new Set([101, 103, 204, 205, 304]);

/**
 * node:http(s) with a lookup that answers with the checked addresses, and no
 * shared agent, so no pooled socket from another request is reused. Answers
 * like fetch: a Response, gzip and brotli bodies decoded, and network
 * failures as TypeError("fetch failed") with the cause.
 */
export const pinnedTransport: Transport = (url, init, addresses) => new Promise<Response>((resolve, reject) => {
  const pinned = addresses.map((address) => ({ address, family: isIP(address) }));
  const lookup = ((_host, options, done) => {
    const family = typeof options === "number" ? options : options?.family;
    const usable = family === 4 || family === 6 ? pinned.filter((entry) => entry.family === family) : pinned;
    if (!usable.length) return done(Object.assign(new Error(`No IPv${family} address for this host.`), { code: "ENOTFOUND" }), "", 0);
    if (typeof options === "object" && options?.all) return (done as unknown as (error: null, all: typeof usable) => void)(null, usable);
    done(null, usable[0]!.address, usable[0]!.family);
  }) as LookupFunction;

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(init.headers)) {
    if (!/^(?:host|accept-encoding|content-length|connection|transfer-encoding)$/i.test(key)) headers[key] = value;
  }
  headers["accept-encoding"] = "gzip, br";
  if (init.body !== null) headers["content-length"] = String(Buffer.byteLength(init.body));

  const fail = (error: unknown) => reject(init.signal?.aborted ? init.signal.reason : new TypeError("fetch failed", { cause: error }));
  try {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)({
      protocol: url.protocol,
      hostname: hostOf(url),
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: init.method,
      headers,
      lookup,
      agent: false,
      signal: init.signal,
    });
    request.on("error", fail);
    request.on("response", (message: IncomingMessage) => {
      const status = message.statusCode ?? 0;
      if (status < 200 || status > 599) {
        message.destroy();
        return fail(new Error(`Unexpected HTTP status ${status}.`));
      }
      const responseHeaders = new Headers();
      for (const [key, value] of Object.entries(message.headers)) {
        for (const each of Array.isArray(value) ? value : value === undefined ? [] : [value]) responseHeaders.append(key, each);
      }
      if (NULL_BODY.has(status) || init.method.toUpperCase() === "HEAD") {
        message.resume();
        return resolve(new Response(null, { status, statusText: message.statusMessage, headers: responseHeaders }));
      }
      const encoding = (message.headers["content-encoding"] ?? "").trim().toLowerCase();
      const decoder = encoding === "gzip" || encoding === "x-gzip" ? createGunzip() : encoding === "br" ? createBrotliDecompress() : null;
      let body: Readable = message;
      if (decoder) {
        body = pipeline(message, decoder, () => {});
        responseHeaders.delete("content-encoding");
        responseHeaders.delete("content-length");
      }
      resolve(new Response(Readable.toWeb(body) as ReadableStream<Uint8Array>, { status, statusText: message.statusMessage, headers: responseHeaders }));
    });
    request.end(init.body ?? undefined);
  } catch (error) {
    fail(error);
  }
});
