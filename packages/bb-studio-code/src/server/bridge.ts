// The link between a workspace's VS Code and the agent. The bridge extension
// inside code-server reports what the user has in front of them and listens
// for commands (show these lines). It talks over a Unix socket in the
// workspace's folder that only this user can open: no port, no token.
import { createHash } from "node:crypto";
import { chmod, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { editorStateSchema, type EditorState } from "../shared";

/** Something the agent asks the user's editor to do. */
export type BridgeCommand = { type: "show"; path: string; startLine: number; endLine: number };

const MAX_BODY = 64 * 1024;
/** Unix socket paths top out near 104 bytes on macOS. */
const MAX_SOCKET_PATH = 100;

/** The socket's path: in the workspace's folder, or a short one in tmp when that's too long. */
export function bridgeSocketPath(dir: string, id: string): string {
  const inside = join(dir, "bridge.sock");
  if (inside.length < MAX_SOCKET_PATH) return inside;
  // tmpdir can be long too (macOS: /var/folders/…/T/); /tmp always exists on macOS and Linux.
  const name = `scb-${createHash("sha256").update(`${dir}\0${id}`).digest("hex").slice(0, 16)}.sock`;
  const temp = join(tmpdir(), name);
  return temp.length < MAX_SOCKET_PATH ? temp : join("/tmp", name);
}

type Bridge = { server: Server; socket: string; clients: Set<ServerResponse>; state: EditorState | null; heartbeat?: ReturnType<typeof setInterval> };

export class Bridges {
  /** `log`: an editor window connected or left (each VS Code page load connects once). */
  constructor(private readonly log: (message: string) => void = () => undefined) {}

  private readonly bridges = new Map<string, Bridge>();
  /** A command for an editor that isn't connected yet, delivered when it connects. */
  private readonly held = new Map<string, BridgeCommand>();

  /** Starts a workspace's bridge and returns its socket path. */
  async open(id: string, dir: string): Promise<string> {
    await this.close(id);
    const socket = bridgeSocketPath(dir, id);
    await rm(socket, { force: true });
    const bridge: Bridge = { server: createServer((req, res) => this.handle(id, req, res)), socket, clients: new Set(), state: null };
    // Keeps event streams open through idle proxies and notices dead ones.
    bridge.heartbeat = setInterval(() => { for (const client of bridge.clients) client.write(": ping\n\n"); }, 25_000);
    bridge.heartbeat.unref?.();
    await new Promise<void>((resolve, reject) => {
      bridge.server.once("error", reject);
      bridge.server.listen(socket, () => resolve());
    });
    await chmod(socket, 0o600);
    this.bridges.set(id, bridge);
    return socket;
  }

  async close(id: string): Promise<void> {
    const bridge = this.bridges.get(id);
    if (!bridge) return;
    this.bridges.delete(id);
    clearInterval(bridge.heartbeat);
    for (const client of bridge.clients) client.end();
    await new Promise<void>((resolve) => bridge.server.close(() => resolve()));
    await rm(bridge.socket, { force: true });
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.bridges.keys()].map((id) => this.close(id)));
  }

  /** What the editor last reported, while it's connected. */
  state(id: string): EditorState | null {
    return this.bridges.get(id)?.state ?? null;
  }

  /** Whether a VS Code window is listening. */
  connected(id: string): boolean {
    return (this.bridges.get(id)?.clients.size ?? 0) > 0;
  }

  /** Sends a command; held for the next editor to connect when none is. Returns whether it went now. */
  send(id: string, command: BridgeCommand): boolean {
    const bridge = this.bridges.get(id);
    if (!bridge?.clients.size) {
      this.held.set(id, command);
      return false;
    }
    this.held.delete(id);
    for (const client of bridge.clients) client.write(`data: ${JSON.stringify(command)}\n\n`);
    return true;
  }

  private handle(id: string, req: IncomingMessage, res: ServerResponse): void {
    const bridge = this.bridges.get(id);
    if (!bridge) { res.writeHead(410).end(); return; }
    if (req.method === "GET" && req.url === "/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write(": connected\n\n");
      bridge.clients.add(res);
      const opened = Date.now();
      this.log(`workspace ${id}: editor window connected (${bridge.clients.size} open)`);
      req.on("close", () => {
        bridge.clients.delete(res);
        this.log(`workspace ${id}: editor window left after ${Math.round((Date.now() - opened) / 1000)}s (${bridge.clients.size} open)`);
        // The last window closed: what it reported no longer holds.
        if (!bridge.clients.size) bridge.state = null;
      });
      const held = this.held.get(id);
      if (held) this.send(id, held);
      return;
    }
    if (req.method === "POST" && req.url === "/state") {
      let body = "";
      let size = 0;
      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY) { res.writeHead(413).end(); req.destroy(); return; }
        body += chunk;
      });
      req.on("end", () => {
        if (res.writableEnded) return;
        let parsed: unknown;
        try { parsed = JSON.parse(body); } catch { res.writeHead(400).end(); return; }
        const result = editorStateSchema.safeParse(parsed);
        if (!result.success) { res.writeHead(400).end(); return; }
        bridge.state = result.data;
        res.writeHead(204).end();
      });
      return;
    }
    res.writeHead(404).end();
  }
}

/** A path as the user knows it: relative to the workspace folder that holds it. */
function shown(path: string, folders: string[]): string {
  for (const folder of folders) {
    const inside = relative(folder, path);
    if (inside && !inside.startsWith("..") && !inside.startsWith("/")) return folders.length > 1 ? `${folder.split("/").at(-1)}/${inside}` : inside;
  }
  return path;
}

const range = (start: number, end: number) => (start === end ? `line ${start}` : `lines ${start}–${end}`);

/**
 * What the agent is told about the user's editors at the start of a turn, or
 * null when none is connected. Paths are relative to their workspace folder.
 */
export function editorContext(editors: { title: string; folders: string[]; state: EditorState }[]): string | null {
  const parts = editors.flatMap(({ title, folders, state }) => {
    const lines: string[] = [];
    const file = state.activeFile;
    if (file) {
      const where = shown(file.path, folders);
      lines.push(`- They're looking at ${where} (${file.language})${file.visible ? `, ${range(file.visible.startLine, file.visible.endLine)} on screen` : ""}.`);
      const { selection } = file;
      if (file.selectedText.trim()) {
        const fence = file.selectedText.includes("```") ? "````" : "```";
        lines.push(`- They've selected ${range(selection.startLine, selection.endLine)} (${file.path}):\n${fence}${file.language}\n${file.selectedText}\n${fence}`);
      } else {
        lines.push(`- Their cursor is on line ${selection.startLine}.`);
      }
      for (const problem of file.problems.slice(0, 10)) lines.push(`- ${problem.severity === "error" ? "Error" : "Warning"} on line ${problem.line}: ${problem.message}`);
    }
    if (state.unsavedFiles.length)
      lines.push(`- Unsaved changes in ${state.unsavedFiles.map((path) => shown(path, folders)).join(", ")}. The files on disk are older than what they see: don't edit these without asking first.`);
    const others = state.openFiles.filter((path) => path !== file?.path);
    if (others.length) lines.push(`- Also open: ${others.slice(0, 15).map((path) => shown(path, folders)).join(", ")}.`);
    if (!lines.length) return [];
    return [`The user has VS Code workspace "${title}" open beside this chat${state.focused ? " and is in it now" : ""}:\n${lines.join("\n")}`];
  });
  if (!parts.length) return null;
  return `${parts.join("\n\n")}\n\nWhen they say "this" or "here", they likely mean their selection or the file above. To point them at code, call code_show with a path and lines; their editor opens there. code_editor_state gives the latest view mid-turn.`;
}
