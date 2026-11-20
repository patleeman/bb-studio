// Bringing servers over from Agent Plugins, once, confirmed by the user.
//
// Two sources: Agent Plugins' database in BB Studio's own data folder
// (plugins/agent-plugins/data.db), and a copy of bb's that the fork's
// "Bring things over" route staged in Studio's secrets folder
// (plugins/studio/secrets/tool-gateway/agent-plugins-import.db), deleted once
// the import has run.
// Both are read read-only. Env and header values were plain text in
// mcp_servers.configJson; they move into Tool Gateway's secret store. OAuth
// sign-ins do not move. A server whose command or folder points inside an
// Agent Plugins package needs a new command first and is not imported.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { ImportCandidate, ImportPreview, ServerKind } from "../contract";

export interface ImportSource { kind: "studio" | "bb"; path: string }

export interface ImportRow {
  candidate: ImportCandidate;
  /** The config as Agent Plugins had it, values included. Server side only. */
  command: string | null;
  args: string[];
  cwd: string | null;
  url: string | null;
  env: Record<string, string>;
  headers: Record<string, string>;
}

export const OLD_PLUGIN_ID = "agent-plugins";

/** Agent Plugins' own database in BB Studio's data folder. */
export const oldPluginDatabase = (dataDir: string) => join(dataDir, "plugins", OLD_PLUGIN_ID, "data.db");

export function importSources(dataDir: string, staged: string): ImportSource[] {
  const out: ImportSource[] = [];
  if (existsSync(staged)) out.push({ kind: "bb", path: staged });
  const own = oldPluginDatabase(dataDir);
  if (existsSync(own)) out.push({ kind: "studio", path: own });
  return out;
}

const PACKAGE_PLACEHOLDER = /\$\{PLUGIN_ROOT\}|\$\{PLUGIN_DATA\}/u;

function strings(value: unknown): Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

/** A server id the contract accepts: it starts with a letter or digit. */
export function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/gu, "-").replace(/^[^a-z0-9]+|[-_]+$/gu, "").slice(0, 64) || "server";
}

const RELATIVE = /^\.\.?(\/|$)/u;

/** Reads Agent Plugins' servers and skills from one database, read-only. */
export function readAgentPlugins(source: ImportSource, existing: ReadonlySet<string>): { rows: ImportRow[]; skills: string[] } {
  const db = new Database(source.path, { readonly: true, fileMustExist: true });
  try {
    db.pragma("busy_timeout = 1000");
    const plugins = new Map((db.prepare("SELECT id, name FROM plugins").all() as { id: string; name: string }[]).map((row) => [row.id, row.name]));
    const servers = db.prepare("SELECT * FROM mcp_servers ORDER BY pluginId, serverId").all() as { pluginId: string; serverId: string; type: string; configJson: string; approved: number; enabled?: number }[];
    let skills: string[] = [];
    try {
      skills = (db.prepare("SELECT pluginId, skillName FROM plugin_skills ORDER BY pluginId, skillName").all() as { pluginId: string; skillName: string }[])
        .map((row) => `${plugins.get(row.pluginId) ?? row.pluginId}: ${row.skillName}`);
    } catch { /* No skills table. */ }
    const taken = new Set<string>();
    const rows: ImportRow[] = [];
    for (const server of servers) {
      let config: Record<string, unknown> = {};
      try { config = JSON.parse(server.configJson) as Record<string, unknown>; } catch { /* Shown as needing a new command. */ }
      const type = typeof config.type === "string" ? config.type : server.type;
      const kind: ServerKind = type === "sse" ? "sse" : type === "streamable-http" || type === "http" ? "streamable-http" : "stdio";
      let id = slug(server.serverId);
      if (taken.has(id)) id = slug(`${server.pluginId}-${server.serverId}`);
      taken.add(id);
      const env = strings(config.env);
      const headers = strings(config.headers);
      const args = Array.isArray(config.args) ? config.args.filter((arg): arg is string => typeof arg === "string") : [];
      const rawCommand = typeof config.command === "string" ? config.command : null;
      const cwd = typeof config.cwd === "string" ? config.cwd : null;
      const url = typeof config.url === "string" ? config.url : null;
      let needsNewCommand: string | null = null;
      const command = rawCommand;
      if (kind === "stdio") {
        if (!rawCommand) needsNewCommand = "It has no command.";
        else if (RELATIVE.test(rawCommand) || PACKAGE_PLACEHOLDER.test(rawCommand)) needsNewCommand = "Its command is inside the Agent Plugins package.";
        else if (args.some((arg) => PACKAGE_PLACEHOLDER.test(arg) || RELATIVE.test(arg)) || Object.values(env).some((value) => PACKAGE_PLACEHOLDER.test(value))) needsNewCommand = "It uses files inside the Agent Plugins package.";
        else if (cwd !== null && (PACKAGE_PLACEHOLDER.test(cwd) || !cwd.startsWith("/"))) needsNewCommand = "Its working folder is inside the Agent Plugins package.";
      } else if (!url) {
        needsNewCommand = "It has no URL.";
      }
      const hasAuthHeader = Object.keys(headers).some((name) => name.toLowerCase() === "authorization");
      rows.push({
        candidate: {
          id,
          label: server.serverId,
          kind,
          command: kind === "stdio" ? command : null,
          args,
          cwd: kind === "stdio" ? cwd : null,
          url: kind === "stdio" ? null : url,
          envNames: Object.keys(env).sort(),
          headerNames: Object.keys(headers).sort(),
          digest: createHash("sha256").update(JSON.stringify([server.pluginId, server.serverId, server.configJson])).digest("hex").slice(0, 32),
          wasApproved: server.approved === 1,
          wasEnabled: server.enabled !== 0,
          oauth: kind !== "stdio" && !hasAuthHeader,
          needsNewCommand,
          exists: existing.has(id),
        },
        command: kind === "stdio" ? command : null,
        args,
        cwd: kind === "stdio" ? cwd : null,
        url: kind === "stdio" ? null : url,
        env,
        headers,
      });
    }
    return { rows, skills };
  } finally {
    db.close();
  }
}

export function previewOf(source: ImportSource | null, rows: ImportRow[], skills: string[], oldPluginInstalled: boolean): ImportPreview {
  return { source: source?.kind ?? null, servers: rows.map((row) => row.candidate), skills, oldPluginInstalled };
}
