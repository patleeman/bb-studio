// Bringing servers over from Agent Plugins, once, confirmed by the user.
//
// Two sources: Agent Plugins' database in BB Studio's own data folder
// (plugins/agent-plugins/data.db), and a copy of bb's that the fork's
// "Bring things over" route staged (plugins/studio/import-staged/tool-gateway.db).
// Both are read read-only. Env and header values were plain text in
// mcp_servers.configJson; they move into Tool Gateway's secret store. OAuth
// sign-ins do not move. A server whose command or folder points inside an
// Agent Plugins package needs a new command first and is not imported.
import { existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { ImportCandidate, ImportPreview, ServerKind } from "../contract";
import { resolveCommand } from "./config";

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

export const STAGED_FILE = ["plugins", "studio", "import-staged", "tool-gateway.db"] as const;
export const OLD_PLUGIN_ID = "agent-plugins";

export function importSources(dataDir: string): ImportSource[] {
  const out: ImportSource[] = [];
  const staged = join(dataDir, ...STAGED_FILE);
  if (existsSync(staged)) out.push({ kind: "bb", path: staged });
  const own = join(dataDir, "plugins", OLD_PLUGIN_ID, "data.db");
  if (existsSync(own)) out.push({ kind: "studio", path: own });
  return out;
}

const PACKAGE_PLACEHOLDER = /\$\{PLUGIN_ROOT\}|\$\{PLUGIN_DATA\}/u;

function strings(value: unknown): Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 64) || "server";
}

/** Reads Agent Plugins' servers and skills from one database, read-only. */
export function readAgentPlugins(source: ImportSource, existing: ReadonlySet<string>, path: string | undefined): { rows: ImportRow[]; skills: string[] } {
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
      let command = rawCommand;
      if (kind === "stdio") {
        if (!rawCommand) needsNewCommand = "It has no command.";
        else if (rawCommand.startsWith("./") || PACKAGE_PLACEHOLDER.test(rawCommand)) needsNewCommand = "Its command is inside the Agent Plugins package.";
        else if (args.some((arg) => PACKAGE_PLACEHOLDER.test(arg)) || (cwd !== null && (cwd.startsWith("./") || PACKAGE_PLACEHOLDER.test(cwd))) || Object.values(env).some((value) => PACKAGE_PLACEHOLDER.test(value))) needsNewCommand = "It uses files inside the Agent Plugins package.";
        else {
          try { command = resolveCommand(rawCommand, path); } catch (error) { needsNewCommand = error instanceof Error ? error.message : String(error); }
        }
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
          url: kind === "stdio" ? null : url,
          envNames: Object.keys(env).sort(),
          headerNames: Object.keys(headers).sort(),
          wasApproved: server.approved === 1,
          wasEnabled: server.enabled !== 0,
          oauth: kind !== "stdio" && !hasAuthHeader,
          needsNewCommand,
          exists: existing.has(id),
        },
        command: kind === "stdio" ? command : null,
        args,
        cwd: cwd && !cwd.startsWith("./") && !PACKAGE_PLACEHOLDER.test(cwd) ? cwd : null,
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
