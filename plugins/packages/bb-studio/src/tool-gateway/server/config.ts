// What a server's config must be, and what Studio passes to it. The approval
// hash binds an approval to one exact config: command, args, working folder,
// env names, URL, header names and the secret values (hashed). The engine
// starts a server only while its current config still has that hash.
import { createHash, createHmac } from "node:crypto";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { DEFAULT_CALL_TIMEOUT_MS, type ServerKind } from "../contract";

export interface ServerConfig {
  kind: ServerKind;
  /** stdio: the resolved absolute path of the command. */
  command: string | null;
  args: string[];
  /** stdio: an absolute folder; null means the server's own private folder. */
  cwd: string | null;
  url: string | null;
  envNames: string[];
  headerNames: string[];
  callTimeoutMs: number;
}

export interface SecretValues {
  env: Record<string, string>;
  headers: Record<string, string>;
}

export const EMPTY_SECRETS: SecretValues = { env: {}, headers: {} };

/** The only variables a stdio server gets from BB's environment. Never BB_*, provider keys or tokens. */
export const ENV_ALLOW_LIST = ["PATH", "HOME", "USER", "SHELL", "LANG", "LC_ALL", "TMPDIR"] as const;

/** Headers a server's config may not set: the transport owns them. */
const RESERVED_HEADERS = new Set(["host", "content-length", "transfer-encoding", "connection", "upgrade", "mcp-session-id", "mcp-protocol-version"]);

export class ConfigError extends Error {}

const sorted = (values: readonly string[]) => [...values].sort();

function secretsDigest(secrets: SecretValues): string {
  const canonical = JSON.stringify({
    env: Object.fromEntries(Object.entries(secrets.env).sort(([a], [b]) => a.localeCompare(b))),
    headers: Object.fromEntries(Object.entries(secrets.headers).map(([name, value]) => [name.toLowerCase(), value] as const).sort(([a], [b]) => a.localeCompare(b))),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * The hash an approval is bound to. Any change to the config or a secret value
 * changes it. It is an HMAC keyed by a random key in the secrets folder, so
 * something that can write only the database can't forge an approval.
 */
export function configHash(config: ServerConfig, secrets: SecretValues, key: string): string {
  const canonical = JSON.stringify({
    kind: config.kind,
    command: config.command,
    args: config.args,
    cwd: config.cwd,
    url: config.url,
    envNames: sorted(config.envNames),
    headerNames: sorted(config.headerNames.map((name) => name.toLowerCase())),
    callTimeoutMs: config.callTimeoutMs,
    secrets: secretsDigest(secrets),
  });
  return createHmac("sha256", key).update(canonical).digest("hex");
}

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The absolute path a command runs as: an absolute path as it is, or a bare
 * name found on the fixed PATH. A relative path (`./cmd`, `bin/cmd`) is
 * refused, so a server never runs from a project folder.
 */
export function resolveCommand(command: string, path: string | undefined): string {
  const trimmed = command.trim();
  if (!trimmed) throw new ConfigError("A stdio server needs a command.");
  if (/[\0\r\n]/u.test(trimmed)) throw new ConfigError("The command has a control character.");
  if (isAbsolute(trimmed)) {
    if (!isExecutableFile(trimmed)) throw new ConfigError(`${trimmed} isn't a program this Mac can run.`);
    return trimmed;
  }
  if (trimmed.includes("/") || trimmed.startsWith(".")) throw new ConfigError("Use an absolute path or a command name on PATH, not a relative path.");
  for (const dir of (path ?? "").split(delimiter)) {
    if (!dir || !isAbsolute(dir)) continue;
    const candidate = join(dir, trimmed);
    if (isExecutableFile(candidate)) return candidate;
  }
  throw new ConfigError(`${trimmed} isn't on PATH.`);
}

export function checkUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new ConfigError("The URL isn't valid.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ConfigError("The URL must start with https:// or http://.");
  if (url.username || url.password) throw new ConfigError("Put credentials in a header, not in the URL.");
  if (url.hash) throw new ConfigError("The URL can't have a #fragment.");
  return url.toString();
}

export function checkHeaderValue(name: string, value: string): void {
  if (RESERVED_HEADERS.has(name.toLowerCase())) throw new ConfigError(`The ${name} header can't be set.`);
  if (/[\0\r\n]/u.test(value)) throw new ConfigError(`The ${name} header has a line break.`);
}

export function checkEnvValue(name: string, value: string): void {
  if (value.includes("\0")) throw new ConfigError(`${name} has a NUL character.`);
}

/** The environment a stdio server starts with: the allow-list from BB's own, then its own variables. */
export function serverEnvironment(base: Record<string, string | undefined>, secrets: SecretValues, names: readonly string[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ENV_ALLOW_LIST) {
    const value = base[name];
    if (typeof value === "string" && value.length > 0) env[name] = value;
  }
  for (const name of names) {
    const value = secrets.env[name];
    if (typeof value === "string") env[name] = value;
  }
  return env;
}

export function defaultConfig(kind: ServerKind): ServerConfig {
  return { kind, command: null, args: [], cwd: null, url: null, envNames: [], headerNames: [], callTimeoutMs: DEFAULT_CALL_TIMEOUT_MS };
}

/**
 * Whether a value looks like a secret worth hiding: long enough, and not a
 * plain word, number, flag, path or plain URL (`true`, `info`, `8080`,
 * `production`, `/usr/local/bin`, `https://api.example.com`).
 */
export function looksSecret(value: string): boolean {
  const text = value.trim();
  if (text.length < 8) return false;
  if (/^(true|false|null|yes|no|on|off|none)$/iu.test(text)) return false;
  if (/^[0-9.:,_-]+$/u.test(text)) return false;
  if (/^[A-Za-z]+(?:[_.:-][A-Za-z]+)*$/u.test(text) && (text === text.toLowerCase() || text === text.toUpperCase() || /^[A-Z][a-z]+(?:[_.:-][A-Z]?[a-z]+)*$/u.test(text))) return false;
  if (/^[~.]?\/[^\s?=&]*$/u.test(text)) return false;
  if (/^https?:\/\/[^\s?#@]+$/iu.test(text)) return false;
  return true;
}

/** The secret-looking values of one server, longest first so a longer value is replaced whole. */
export function secretValuesOf(secrets: SecretValues): string[] {
  return [...Object.values(secrets.env), ...Object.values(secrets.headers)]
    .flatMap((value) => {
      const out = [value];
      // A bearer header's token is a secret on its own too.
      const bearer = /^(?:bearer|basic|token)\s+(.+)$/iu.exec(value)?.[1];
      if (bearer) out.push(bearer);
      return out;
    })
    .filter(looksSecret)
    .sort((a, b) => b.length - a.length);
}

export const MASK = "•••";

/** Replaces every known secret value in a text with •••. */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) if (secret && out.includes(secret)) out = out.split(secret).join(MASK);
  return out;
}

/** Masks secrets in every string of a value (a tool result), keys and structure untouched. */
export function redactDeep<T>(value: T, secrets: readonly string[]): T {
  if (secrets.length === 0) return value;
  const walk = (item: unknown): unknown => {
    if (typeof item === "string") return redact(item, secrets);
    if (Array.isArray(item)) return item.map(walk);
    if (item !== null && typeof item === "object") return Object.fromEntries(Object.entries(item as Record<string, unknown>).map(([key, child]) => [key, walk(child)]));
    return item;
  };
  return walk(value) as T;
}

/** Whether a field holds the mask: it came from a masked view, not from the user. */
export const hasMask = (value: string | null | undefined) => typeof value === "string" && value.includes(MASK);
