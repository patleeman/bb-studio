import { execFile } from "node:child_process";
import { delimiter } from "node:path";

/**
 * Some gateways take a short-lived token from a CLI instead of a stored key.
 * The key command's output is the bearer token. BB's server may start with a
 * minimal PATH, so the usual install locations are searched too.
 */
const extraPath = ["/opt/homebrew/bin", "/usr/local/bin"];
/** Refresh this long before the token's own expiry. */
const refreshMarginMs = 60_000;
/** Used when the token carries no readable expiry. */
const fallbackLifetimeMs = 5 * 60_000;

type Cached = { token: string; expiresAt: number };
const cache = new Map<string, Cached>();
const pending = new Map<string, Promise<string>>();

/** Reads `exp` from a JWT without verifying it; the endpoint does that. */
export function tokenExpiry(token: string, now = Date.now()): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    if (typeof payload.exp === "number") return payload.exp * 1000 - refreshMarginMs;
  } catch {
    // Not a JWT; fall through.
  }
  return now + fallbackLifetimeMs;
}

function runKeyCommand(command: string, timeoutMs: number): Promise<string> {
  const PATH = [process.env.PATH, ...extraPath].filter(Boolean).join(delimiter);
  return new Promise((resolve, reject) => {
    execFile(
      "/bin/sh",
      ["-c", command],
      { env: { ...process.env, PATH }, timeout: timeoutMs, maxBuffer: 64 * 1024 },
      (error, stdout) => {
        const token = stdout.trim();
        // Never echo the output: on failure it may still hold a credential.
        if (error || !token || /\s/.test(token)) reject(new Error("The custom Jev key command did not print a token."));
        else resolve(token);
      },
    );
  });
}

/** The command's token, cached until it expires and fetched once at a time. */
export async function commandToken(command: string, timeoutMs = 15_000): Promise<string> {
  const cached = cache.get(command);
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  let request = pending.get(command);
  if (!request) {
    request = runKeyCommand(command, timeoutMs)
      .then((token) => {
        cache.set(command, { token, expiresAt: tokenExpiry(token) });
        return token;
      })
      .finally(() => pending.delete(command));
    pending.set(command, request);
  }
  return request;
}

/** Whether the next `commandToken` call would reuse a cached token instead of running the command. */
export function hasCommandToken(command: string) {
  const cached = cache.get(command);
  return !!cached && cached.expiresAt > Date.now();
}

/** Drops a token the endpoint rejected, so the next call runs the command again. */
export function forgetCommandToken(command: string) {
  cache.delete(command);
}
