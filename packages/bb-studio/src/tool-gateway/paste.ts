// Reads a pasted `mcpServers` JSON block (Claude Desktop, Cursor, Agent
// Plugins' mcp.json) into server forms. Shared by the page and the server, so
// it imports nothing from Node.
import type { ServerKind } from "./contract";

export class PasteError extends Error {}

/** Parses a pasted `mcpServers` JSON block (Claude Desktop, Cursor, Agent Plugins' mcp.json) into server inputs. */
export function parseMcpServersJson(text: string): { id: string; kind: ServerKind; command?: string; args?: string[]; cwd?: string | null; url?: string; env?: Record<string, string>; headers?: Record<string, string> }[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new PasteError("That isn't JSON.");
  }
  const root = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  const servers = root && typeof root.mcpServers === "object" && root.mcpServers !== null ? root.mcpServers as Record<string, unknown> : root;
  if (!servers) throw new PasteError("Expected an object with mcpServers.");
  const out: ReturnType<typeof parseMcpServersJson> = [];
  for (const [name, value] of Object.entries(servers)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new PasteError(`${name} isn't a server.`);
    const raw = value as Record<string, unknown>;
    const id = name.toLowerCase().replace(/[^a-z0-9_-]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 64) || "server";
    const strings = (input: unknown) => (input && typeof input === "object" && !Array.isArray(input) ? Object.fromEntries(Object.entries(input as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : undefined);
    const type = typeof raw.type === "string" ? raw.type : typeof raw.transport === "string" ? raw.transport : undefined;
    if (typeof raw.url === "string") {
      const kind: ServerKind = type === "sse" ? "sse" : "streamable-http";
      out.push({ id, kind, url: raw.url, headers: strings(raw.headers) });
    } else if (typeof raw.command === "string") {
      out.push({ id, kind: "stdio", command: raw.command, args: Array.isArray(raw.args) ? raw.args.filter((arg): arg is string => typeof arg === "string") : [], cwd: typeof raw.cwd === "string" ? raw.cwd : null, env: strings(raw.env) });
    } else {
      throw new PasteError(`${name} needs a command or a url.`);
    }
  }
  return out;
}
