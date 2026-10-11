// Reaching BB. All BB data goes through the applets plugin's RPC API (or, for
// approved bb.rpc capabilities, another plugin's RPC) on the local BB server.
// The look comes from BB too: its compiled stylesheet and the active theme.
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { root } from "./paths";

// The last stylesheet BB served, so applets keep BB's look while BB is down.
const cssCachePath = join(root, ".cache", "bb.css");

export class BbUnavailable extends Error {
  readonly code = "bb_unavailable";
}

async function serverUrl(): Promise<string> {
  if (process.env.BB_SERVER_URL) return process.env.BB_SERVER_URL.replace(/\/$/, "");
  const dataDir = process.env.BB_DATA_DIR || join(homedir(), ".bb");
  try {
    const config = JSON.parse(await readFile(join(dataDir, "config.json"), "utf8")) as { serverUrl?: unknown };
    if (typeof config.serverUrl === "string") return config.serverUrl.replace(/\/$/, "");
  } catch {
    // Fall through to BB's default port.
  }
  return "http://127.0.0.1:38886";
}

export async function pluginRpc(pluginId: string, method: string, input: unknown): Promise<unknown> {
  const base = await serverUrl();
  let response: Response;
  try {
    response = await fetch(`${base}/api/v1/plugins/${encodeURIComponent(pluginId)}/rpc/${encodeURIComponent(method)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input ?? null),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new BbUnavailable("BB isn't running");
  }
  const body = (await response.json().catch(() => null)) as { ok?: boolean; result?: unknown; error?: unknown } | null;
  if (body?.ok) return body.result;
  const error = body?.error;
  const message = typeof error === "string" ? error : (error as { message?: string } | undefined)?.message ?? `HTTP ${response.status}`;
  if (/unknown plugin/.test(message)) throw new BbUnavailable(`The ${pluginId} plugin isn't installed in BB`);
  throw new Error(message);
}

export function appletsRpc(method: string, input: unknown): Promise<unknown> {
  return pluginRpc("applets", method, input);
}

export async function isConnected(): Promise<boolean> {
  return appletsRpc("applets.list", null).then(
    () => true,
    () => false,
  );
}

let cssCache: { at: number; css: string } | null = null;

/** BB's compiled app stylesheet: Tailwind v4 utilities plus every design token. */
export async function bbStylesheet(): Promise<string> {
  if (cssCache && Date.now() - cssCache.at < 60_000) return cssCache.css;
  const base = await serverUrl();
  try {
    const html = await (await fetch(`${base}/`, { signal: AbortSignal.timeout(5000) })).text();
    const href = /<link[^>]+rel="stylesheet"[^>]+href="([^"]+\.css)"/.exec(html)?.[1] ?? /href="(\/assets\/[^"]+\.css)"/.exec(html)?.[1];
    if (!href) throw new Error("no stylesheet");
    const css = await (await fetch(new URL(href, base), { signal: AbortSignal.timeout(5000) })).text();
    cssCache = { at: Date.now(), css };
    void mkdir(join(root, ".cache"), { recursive: true }).then(() => writeFile(cssCachePath, css)).catch(() => {});
    return css;
  } catch {
    return cssCache?.css ?? (await readFile(cssCachePath, "utf8").catch(() => ""));
  }
}

const BB_CANDIDATES = [process.env.BB_CLI, join(homedir(), ".local", "bin", "bb"), "/usr/local/bin/bb", "/opt/homebrew/bin/bb"].filter(
  (path): path is string => Boolean(path),
);

/** The active BB theme's CSS overrides (`bb theme show --css`), or "" if unavailable. */
export async function bbTheme(): Promise<string> {
  for (const bin of BB_CANDIDATES) {
    const css = await new Promise<string | null>((resolve) =>
      execFile(bin, ["theme", "show", "--css"], { timeout: 5000 }, (error, stdout) => resolve(error ? null : stdout)),
    );
    if (css !== null) return css;
  }
  return "";
}
