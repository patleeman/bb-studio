// Tool Gateway's rows in Studio's database (migration in src/migrations.ts):
// servers, requests and each server's log. Secret values are never here; they
// are in the secret store (secrets.ts). Per-provider access is in plugin kv.
import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import type { ProviderAccess, RequestInput, ServerStatus } from "../contract";
import type { ServerConfig } from "./config";

export type ServerSource = "added" | "request" | "import";

export interface ToolDigest { name: string; digest: string }

export interface ServerRecord {
  id: string;
  label: string;
  config: ServerConfig;
  enabled: boolean;
  /** The config hash the user approved; null until approved. */
  approvedHash: string | null;
  approvedAt: number | null;
  disabledTools: string[];
  /** Projects the server works in; null for every project. */
  projects: string[] | null;
  source: ServerSource;
  /** Last persisted state, for the page; the engine holds the live one. */
  status: Extract<ServerStatus, "stopped" | "error" | "needs-sign-in">;
  lastError: string | null;
  /** The tool list the user approved, to show "Tools changed". */
  approvedTools: ToolDigest[] | null;
  createdAt: number;
  updatedAt: number;
}

export interface RequestRecord {
  id: string;
  input: RequestInput;
  threadId: string | null;
  projectId: string | null;
  state: "pending" | "approved" | "declined";
  taskId: string | null;
  createdAt: number;
  decidedAt: number | null;
}

export interface LogLine { at: number; kind: string; text: string }

export const LOG_LINES_PER_SERVER = 500;
export const LOG_KEEP_MS = 7 * 24 * 60 * 60_000;
export const PROVIDERS_KEY = "tool-gateway:providers";

type Kv = { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> };

export class ToolGatewayStore {
  private servers = new Map<string, ServerRecord>();
  private providerAccess: Record<string, ProviderAccess> = {};
  private readonly listeners = new Set<() => void>();

  constructor(private readonly db: Database.Database, private readonly kv: Kv | null = null, private readonly now: () => number = Date.now) {
    for (const row of db.prepare("SELECT record FROM tool_gateway_servers").all() as { record: string }[]) {
      try {
        const record = JSON.parse(row.record) as ServerRecord;
        this.servers.set(record.id, record);
      } catch {
        // A row that can't be read is skipped; it can be removed and added again.
      }
    }
  }

  async loadProviders(): Promise<void> {
    const value = await this.kv?.get(PROVIDERS_KEY);
    this.providerAccess = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, ProviderAccess> : {};
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    for (const listener of this.listeners) {
      try { listener(); } catch { /* A listener's failure doesn't undo the write. */ }
    }
  }

  /** Every row read again from the database, so a change made outside Studio is seen. */
  freshServers(): ServerRecord[] {
    const next = new Map<string, ServerRecord>();
    for (const row of this.db.prepare("SELECT record FROM tool_gateway_servers").all() as { record: string }[]) {
      try {
        const record = JSON.parse(row.record) as ServerRecord;
        next.set(record.id, record);
      } catch { /* Skipped, as at load. */ }
    }
    this.servers = next;
    return this.listServers();
  }

  listServers(): ServerRecord[] {
    return [...this.servers.values()].sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  }

  getServer(id: string): ServerRecord | null {
    return this.servers.get(id) ?? null;
  }

  requireServer(id: string): ServerRecord {
    const record = this.servers.get(id);
    if (!record) throw new Error(`There's no server called ${id}.`);
    return record;
  }

  saveServer(record: ServerRecord): ServerRecord {
    const next = { ...record, updatedAt: this.now() };
    this.db.prepare("INSERT INTO tool_gateway_servers (id, record, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET record = excluded.record, updated_at = excluded.updated_at").run(next.id, JSON.stringify(next), next.updatedAt);
    this.servers.set(next.id, next);
    this.changed();
    return next;
  }

  /** Writes a status without counting it as a change to the config. */
  setStatus(id: string, status: ServerRecord["status"], lastError: string | null): void {
    const record = this.servers.get(id);
    if (!record || (record.status === status && record.lastError === lastError)) return;
    this.saveServer({ ...record, status, lastError });
  }

  removeServer(id: string): void {
    this.db.prepare("DELETE FROM tool_gateway_servers WHERE id = ?").run(id);
    this.db.prepare("DELETE FROM tool_gateway_log WHERE server_id = ?").run(id);
    this.servers.delete(id);
    this.changed();
  }

  /** Reads the row again from the database, so a change made outside Studio is seen. */
  reloadServer(id: string): ServerRecord | null {
    const row = this.db.prepare("SELECT record FROM tool_gateway_servers WHERE id = ?").get(id) as { record: string } | undefined;
    if (!row) {
      this.servers.delete(id);
      return null;
    }
    const record = JSON.parse(row.record) as ServerRecord;
    this.servers.set(id, record);
    return record;
  }

  addRequest(input: RequestInput, context: { threadId: string | null; projectId: string | null }): RequestRecord {
    const record: RequestRecord = {
      id: `tgr_${randomBytes(8).toString("hex")}`,
      input,
      threadId: context.threadId,
      projectId: context.projectId,
      state: "pending",
      taskId: null,
      createdAt: this.now(),
      decidedAt: null,
    };
    this.writeRequest(record);
    return record;
  }

  writeRequest(record: RequestRecord): RequestRecord {
    this.db.prepare("INSERT INTO tool_gateway_requests (id, record, state, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET record = excluded.record, state = excluded.state").run(record.id, JSON.stringify(record), record.state, record.createdAt);
    this.changed();
    return record;
  }

  getRequest(id: string): RequestRecord | null {
    const row = this.db.prepare("SELECT record FROM tool_gateway_requests WHERE id = ?").get(id) as { record: string } | undefined;
    return row ? JSON.parse(row.record) as RequestRecord : null;
  }

  listRequests(state?: RequestRecord["state"]): RequestRecord[] {
    const rows = (state
      ? this.db.prepare("SELECT record FROM tool_gateway_requests WHERE state = ? ORDER BY created_at DESC LIMIT 200").all(state)
      : this.db.prepare("SELECT record FROM tool_gateway_requests ORDER BY created_at DESC LIMIT 200").all()) as { record: string }[];
    return rows.map((row) => JSON.parse(row.record) as RequestRecord);
  }

  /** Appends a log line that is already free of secrets. Keeps the last 500 per server, for 7 days. */
  log(serverId: string, kind: string, text: string): void {
    const at = this.now();
    this.db.prepare("INSERT INTO tool_gateway_log (server_id, at, kind, text) VALUES (?, ?, ?, ?)").run(serverId, at, kind, text.slice(0, 4000));
    this.db.prepare("DELETE FROM tool_gateway_log WHERE server_id = ? AND (at < ? OR seq <= (SELECT seq FROM tool_gateway_log WHERE server_id = ? ORDER BY seq DESC LIMIT 1 OFFSET ?))").run(serverId, at - LOG_KEEP_MS, serverId, LOG_LINES_PER_SERVER);
  }

  logLines(serverId: string, limit = LOG_LINES_PER_SERVER): LogLine[] {
    return (this.db.prepare("SELECT at, kind, text FROM tool_gateway_log WHERE server_id = ? ORDER BY seq DESC LIMIT ?").all(serverId, limit) as LogLine[]).reverse();
  }

  providers(): Record<string, ProviderAccess> {
    return { ...this.providerAccess };
  }

  providerAccessFor(providerId: string): ProviderAccess {
    return this.providerAccess[providerId] ?? { access: true, servers: "all" };
  }

  async setProvider(providerId: string, access: ProviderAccess): Promise<void> {
    const next = { ...this.providerAccess };
    if (access.access && access.servers === "all") delete next[providerId];
    else next[providerId] = access;
    await this.kv?.set(PROVIDERS_KEY, next);
    this.providerAccess = next;
    this.changed();
  }
}
