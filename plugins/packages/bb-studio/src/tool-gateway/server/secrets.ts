// Tool Gateway's secret values: each server's env values and header values,
// and its OAuth sign-in. They live in Studio's secrets folder
// (plugins/studio/secrets/tool-gateway, 0700, files 0600), never in the
// database, a snapshot, a log line or anything an agent receives.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EMPTY_SECRETS, secretValuesOf, type SecretValues } from "./config";
import type { OAuthCredentialBackend, OAuthCredentialRecord } from "./oauth";

const SERVERS_FILE = "servers.json";
const OAUTH_FILE = "oauth.json";

async function readJson(path: string): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

function cleanValues(value: unknown): SecretValues {
  const record = value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
  const strings = (input: unknown) => Object.fromEntries(Object.entries(input !== null && typeof input === "object" ? input as Record<string, unknown> : {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  return { env: strings(record.env), headers: strings(record.headers) };
}

export class ToolGatewaySecrets {
  private servers: Record<string, SecretValues> = {};
  private oauth: Record<string, OAuthCredentialRecord> = {};
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly dir: string) {}

  async load(): Promise<void> {
    const servers = await readJson(join(this.dir, SERVERS_FILE));
    this.servers = Object.fromEntries(Object.entries(servers).map(([id, value]) => [id, cleanValues(value)]));
    this.oauth = await readJson(join(this.dir, OAUTH_FILE)) as Record<string, OAuthCredentialRecord>;
  }

  get(serverId: string): SecretValues {
    const value = this.servers[serverId];
    return value ? { env: { ...value.env }, headers: { ...value.headers } } : { env: {}, headers: {} };
  }

  set(serverId: string, values: SecretValues): Promise<void> {
    const empty = Object.keys(values.env).length === 0 && Object.keys(values.headers).length === 0;
    const next = { ...this.servers };
    if (empty) delete next[serverId];
    else next[serverId] = { env: { ...values.env }, headers: { ...values.headers } };
    this.servers = next;
    return this.write(SERVERS_FILE, next);
  }

  async delete(serverId: string): Promise<void> {
    await this.set(serverId, EMPTY_SECRETS);
    if (this.oauth[serverId]) {
      const next = { ...this.oauth };
      delete next[serverId];
      this.oauth = next;
      await this.write(OAUTH_FILE, next);
    }
  }

  /** Every value to hide from logs, errors and anything an agent sees, longest first. */
  values(): string[] {
    const out = new Set<string>();
    for (const values of Object.values(this.servers)) for (const value of secretValuesOf(values)) out.add(value);
    for (const record of Object.values(this.oauth)) {
      for (const value of [record.tokens?.access_token, record.tokens?.refresh_token, (record.clientInformation as { client_secret?: string } | undefined)?.client_secret, record.codeVerifier, record.state]) {
        if (typeof value === "string" && value.length >= 4) out.add(value);
      }
    }
    return [...out].sort((a, b) => b.length - a.length);
  }

  oauthBackend(): OAuthCredentialBackend {
    return {
      load: async () => JSON.parse(JSON.stringify(this.oauth)) as Record<string, OAuthCredentialRecord>,
      save: async (value) => {
        this.oauth = JSON.parse(JSON.stringify(value)) as Record<string, OAuthCredentialRecord>;
        await this.write(OAUTH_FILE, this.oauth);
      },
    };
  }

  hasOAuth(serverId: string): boolean {
    return Boolean(this.oauth[serverId]?.tokens?.access_token);
  }

  private write(file: string, value: unknown): Promise<void> {
    const run = this.queue.then(async () => {
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      const path = join(this.dir, file);
      const temp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
      try {
        await writeFile(temp, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
        await rename(temp, path);
      } catch (error) {
        await rm(temp, { force: true });
        throw error;
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
