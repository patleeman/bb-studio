// Tool Gateway's secret values: each server's env values and header values,
// and its OAuth sign-in. They live in Studio's secrets folder
// (plugins/studio/secrets/tool-gateway, 0700, files 0600), never in the
// database, a snapshot, a log line or anything an agent receives.
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EMPTY_SECRETS, secretValuesOf, type SecretValues } from "./config";
import type { OAuthCredentialBackend, OAuthCredentialRecord } from "./oauth";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const SERVERS_FILE = "servers.json";
const OAUTH_FILE = "oauth.json";
const KEY_FILE = "approval.key";
/** Where a staged copy of Agent Plugins' data waits for the import: plain-text values, so it lives with the secrets. */
export const STAGED_IMPORT_FILE = "agent-plugins-import.db";

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
  private key = "";
  private problems = new Map<string, string>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly dir: string) {}

  /**
   * Reads the key first, then each file on its own. A file that can't be read
   * never throws: its problem is kept, nothing in it counts (so no server is
   * approved), and it is never overwritten until it is fixed or removed.
   */
  async load(): Promise<string[]> {
    this.problems = new Map();
    await this.loadKey().catch((error) => { this.key = ""; this.problems.set(KEY_FILE, errorText(error)); });
    try {
      const servers = await readJson(join(this.dir, SERVERS_FILE));
      this.servers = Object.fromEntries(Object.entries(servers).map(([id, value]) => [id, cleanValues(value)]));
    } catch (error) {
      this.servers = {};
      this.problems.set(SERVERS_FILE, errorText(error));
    }
    try {
      this.oauth = await readJson(join(this.dir, OAUTH_FILE)) as Record<string, OAuthCredentialRecord>;
    } catch (error) {
      this.oauth = {};
      this.problems.set(OAUTH_FILE, errorText(error));
    }
    return [...this.problems].map(([file, problem]) => `${file}: ${problem}`);
  }

  /** The approval hash's key: 32 random bytes made once, kept here (0600). A key file that exists but can't be read is left alone. */
  private async loadKey(): Promise<void> {
    try {
      this.key = (await readFile(join(this.dir, KEY_FILE), "utf8")).trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (this.key.length >= 32) return;
    if (this.key.length > 0) throw new Error("the key is too short");
    this.key = randomBytes(32).toString("base64url");
    await this.writeText(KEY_FILE, this.key);
  }

  /** null when the key couldn't be loaded: then nothing is approved, and nothing can be. */
  approvalKey(): string | null {
    return this.key || null;
  }

  /** Why the secrets can't be used as they are, for the page and the log; empty when all is well. */
  loadProblems(): string[] {
    return [...this.problems].map(([file, problem]) => `${file}: ${problem}`);
  }

  private refuseIfBroken(file: string): void {
    const problem = this.problems.get(file);
    if (problem !== undefined) throw new Error(`Tool Gateway's ${file} can't be read (${problem}). Fix or remove it in the secrets folder, then reload Studio.`);
  }

  stagedImportPath(): string {
    return join(this.dir, STAGED_IMPORT_FILE);
  }

  get(serverId: string): SecretValues {
    const value = this.servers[serverId];
    return value ? { env: { ...value.env }, headers: { ...value.headers } } : { env: {}, headers: {} };
  }

  set(serverId: string, values: SecretValues): Promise<void> {
    this.refuseIfBroken(SERVERS_FILE);
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

  /** Values to hide: one server's (its results), or every server's (logs and errors), longest first. */
  values(serverId?: string): string[] {
    const out = new Set<string>();
    const servers = serverId === undefined ? Object.values(this.servers) : this.servers[serverId] ? [this.servers[serverId]!] : [];
    for (const values of servers) for (const value of secretValuesOf(values)) out.add(value);
    const records = serverId === undefined ? Object.values(this.oauth) : this.oauth[serverId] ? [this.oauth[serverId]!] : [];
    for (const record of records) {
      for (const value of [record.tokens?.access_token, record.tokens?.refresh_token, (record.clientInformation as { client_secret?: string } | undefined)?.client_secret, record.codeVerifier, record.state]) {
        if (typeof value === "string" && value.length >= 8) out.add(value);
      }
    }
    return [...out].sort((a, b) => b.length - a.length);
  }

  oauthBackend(): OAuthCredentialBackend {
    return {
      load: async () => JSON.parse(JSON.stringify(this.oauth)) as Record<string, OAuthCredentialRecord>,
      save: async (value) => {
        this.refuseIfBroken(OAUTH_FILE);
        this.oauth = JSON.parse(JSON.stringify(value)) as Record<string, OAuthCredentialRecord>;
        await this.write(OAUTH_FILE, this.oauth);
      },
    };
  }

  hasOAuth(serverId: string): boolean {
    return Boolean(this.oauth[serverId]?.tokens?.access_token);
  }

  private write(file: string, value: unknown): Promise<void> {
    return this.writeText(file, JSON.stringify(value));
  }

  private writeText(file: string, text: string): Promise<void> {
    const run = this.queue.then(async () => {
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      // mkdir doesn't tighten a folder that is already there.
      await chmod(this.dir, 0o700);
      const path = join(this.dir, file);
      const temp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
      try {
        await writeFile(temp, text, { encoding: "utf8", mode: 0o600 });
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
