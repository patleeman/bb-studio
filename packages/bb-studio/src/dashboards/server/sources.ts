// Where widget data comes from: URLs the Studio server fetches (JSON or
// RSS/Atom) and shell commands it runs on the BB host once the user approves
// them. Both are capped in time and size.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { LIMITS, selectPath, jsonBytes, type Source } from "../shared";

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export interface FetchedBody {
  text: string;
  contentType: string;
  url: string;
}

/** Reads at most `max` bytes of a body; throws past it. */
async function readCapped(response: Response, max: number): Promise<string> {
  const length = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(length) && length > max) throw new Error(`The response is over ${Math.round(max / 1024 / 1024)} MB.`);
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new Error(`The response is over ${Math.round(max / 1024 / 1024)} MB.`);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

const httpOnly = (url: URL) => {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`Only http and https addresses can be fetched, not ${url.protocol.replace(/:$/, "")}.`);
  if (url.username || url.password) throw new Error("Addresses with a user name or password aren't fetched.");
};

/**
 * GETs an http(s) URL: a 15 s budget for the whole exchange, at most 5
 * redirects (each to http or https), and a 2 MB body.
 */
export async function fetchUrl(address: string, options: { fetch?: Fetch; timeoutMs?: number; maxBytes?: number; maxRedirects?: number } = {}): Promise<FetchedBody> {
  const fetcher = options.fetch ?? (globalThis.fetch as Fetch);
  const timeoutMs = options.timeoutMs ?? LIMITS.urlTimeoutMs;
  const maxBytes = options.maxBytes ?? LIMITS.urlBytes;
  const maxRedirects = options.maxRedirects ?? LIMITS.urlRedirects;
  const signal = AbortSignal.timeout(timeoutMs);
  let url = new URL(address);
  try {
    for (let hop = 0; ; hop++) {
      httpOnly(url);
      const response = await fetcher(url.toString(), {
        method: "GET",
        redirect: "manual",
        signal,
        headers: { accept: "application/json, application/rss+xml, application/atom+xml, application/xml;q=0.9, text/*;q=0.5", "user-agent": "BB-Studio-Dashboards/1" },
      });
      if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
        await response.body?.cancel().catch(() => {});
        if (hop >= maxRedirects) throw new Error(`More than ${maxRedirects} redirects.`);
        url = new URL(response.headers.get("location")!, url);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new Error(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`);
      }
      const text = await readCapped(response, maxBytes);
      return { text, contentType: response.headers.get("content-type") ?? "", url: url.toString() };
    }
  } catch (error) {
    if (signal.aborted) throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)} s.`);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// RSS and Atom, read with a few regular expressions: enough for headlines.

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const n = code[1]?.toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** Text of an element: CDATA kept, tags dropped, entities decoded, whitespace collapsed. */
function textOf(xml: string): string {
  const cdata = xml.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, inner: string) => inner.replace(/</g, "\u0001"));
  const decoded = decodeEntities(cdata.replace(/<[^>]*>/g, " ")).replace(/\u0001/g, "<");
  // HTML inside CDATA (descriptions) loses its tags too.
  return decodeEntities(decoded.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function element(block: string, name: string): string | null {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(block);
  return match ? textOf(match[1]!) : null;
}

function atomLink(block: string): string | null {
  const links = [...block.matchAll(/<link\b([^>]*)\/?>/gi)].map((match) => match[1]!);
  const pick = links.find((attrs) => /rel=["']alternate["']/i.test(attrs)) ?? links.find((attrs) => !/rel=/i.test(attrs)) ?? links[0];
  const href = pick ? /href=["']([^"']+)["']/i.exec(pick)?.[1] : null;
  return href ? decodeEntities(href) : null;
}

export interface FeedItem { title: string; link: string | null; date: string | null; summary: string | null }
export interface Feed { title: string | null; items: FeedItem[] }

const MAX_FEED_ITEMS = 100;
const clip = (text: string | null, max: number) => (text && text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** An RSS 2.0, RSS 1.0 or Atom document as `{title, items}`; null when it isn't one. */
export function parseFeed(xml: string): Feed | null {
  if (!/<(rss|feed|rdf:RDF)\b/i.test(xml)) return null;
  const atom = /<feed\b/i.test(xml);
  const blocks = [...xml.matchAll(atom ? /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi : /<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => match[1]!);
  const head = xml.split(atom ? /<entry\b/i : /<item\b/i)[0] ?? "";
  const items = blocks.slice(0, MAX_FEED_ITEMS).map((block) => {
    const link = atom ? atomLink(block) : element(block, "link") || (/<guid[^>]*isPermaLink=["']true["'][^>]*>([^<]+)</i.exec(block)?.[1] ?? null);
    const date = element(block, atom ? "updated" : "pubDate") ?? element(block, "published") ?? element(block, "dc:date");
    const parsed = date ? Date.parse(date) : NaN;
    return {
      title: clip(element(block, "title") ?? "(untitled)", 300)!,
      link: link && /^https?:\/\//i.test(link.trim()) ? link.trim() : null,
      date: Number.isFinite(parsed) ? new Date(parsed).toISOString() : date,
      summary: clip(element(block, atom ? "summary" : "description") ?? (atom ? element(block, "content") : null), 400),
    };
  });
  return { title: element(head, "title"), items };
}

/** A fetched body as data: JSON, or a feed. */
export function decodeBody(body: { text: string; contentType: string }, format: "auto" | "json" | "rss" = "auto"): unknown {
  const text = body.text.replace(/^﻿/, "");
  const looksJson = /json/i.test(body.contentType) || /^\s*[[{]/.test(text);
  if (format === "json" || (format === "auto" && looksJson)) {
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`The response isn't valid JSON (${error instanceof Error ? error.message : String(error)}).`);
    }
  }
  const feed = parseFeed(text);
  if (feed) return feed;
  throw new Error(format === "rss" ? "The response isn't an RSS or Atom feed." : "The response is neither JSON nor an RSS or Atom feed.");
}

// ---------------------------------------------------------------------------
// Scripts.

/** What an approval pins: the exact command and working directory. */
export function scriptHash(source: Pick<Source, "command" | "cwd">): string {
  return createHash("sha256").update(JSON.stringify({ command: source.command ?? "", cwd: source.cwd ?? null })).digest("hex");
}

export type Exec = (file: string, args: string[], options: { cwd: string; timeout: number; maxBuffer: number; killSignal: NodeJS.Signals; windowsHide: boolean; env: NodeJS.ProcessEnv }, done: (error: (Error & { code?: unknown; killed?: boolean; signal?: unknown }) | null, stdout: string, stderr: string) => void) => unknown;

/**
 * Runs a command with the user's shell on the BB host (the Studio server's
 * own machine): 30 s, then it's killed; more than 1 MB on stdout fails.
 * Prints JSON, or plain text, which becomes a string.
 */
export function runScript(source: Pick<Source, "command" | "cwd">, options: { exec?: Exec; timeoutMs?: number; maxBytes?: number } = {}): Promise<unknown> {
  const exec = options.exec ?? (execFile as unknown as Exec);
  const timeoutMs = options.timeoutMs ?? LIMITS.scriptTimeoutMs;
  const maxBytes = options.maxBytes ?? LIMITS.scriptBytes;
  const windows = process.platform === "win32";
  const shell = windows ? (process.env.ComSpec ?? "cmd.exe") : "/bin/sh";
  const args = windows ? ["/d", "/s", "/c", source.command ?? ""] : ["-c", source.command ?? ""];
  return new Promise((resolve, reject) => {
    exec(shell, args, { cwd: source.cwd || homedir(), timeout: timeoutMs, maxBuffer: maxBytes, killSignal: "SIGKILL", windowsHide: true, env: process.env }, (error, stdout, stderr) => {
      if (error) {
        if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return reject(new Error(`The command printed more than ${Math.round(maxBytes / 1024)} KB.`));
        if (error.killed || error.signal === "SIGKILL") return reject(new Error(`The command took longer than ${Math.round(timeoutMs / 1000)} s and was stopped.`));
        const detail = String(stderr || error.message).trim().slice(0, 400);
        return reject(new Error(typeof error.code === "number" ? `The command exited with code ${error.code}${detail ? `: ${detail}` : ""}` : detail || "The command failed."));
      }
      const out = String(stdout).trim();
      if (!out) return resolve(null);
      try {
        resolve(JSON.parse(out));
      } catch {
        resolve(out);
      }
    });
  });
}

/** The value a widget keeps: `select` applied, size checked. */
export function keepValue(raw: unknown, select: string | undefined): unknown {
  const value = selectPath(raw, select);
  if (value === undefined) throw new Error(`Nothing at "${select}" in the result.`);
  if (jsonBytes(value) > LIMITS.valueBytes) throw new Error(`The data is over ${LIMITS.valueBytes / 1024} KB after selecting.`);
  return value;
}
