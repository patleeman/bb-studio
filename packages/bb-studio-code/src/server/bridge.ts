// The link between a workspace's VS Code and the agent. The bridge extension
// inside code-server reports what the user has in front of them and listens
// for commands (show these lines). It talks over a Unix socket in the
// workspace's folder that only this user can open: no port, no token.
import { createHash, randomUUID } from "node:crypto";
import { chmod, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { z } from "zod";
import { editorStateSchema, type EditorState } from "../shared";
import type { Activity } from "./activity";
import type { TextEdit } from "./edits";

/** Something the agent asks the user's editor to do, or tells it is happening. */
export type BridgeCommand =
  | { type: "show"; path: string; startLine: number; endLine: number }
  | { type: "edit"; path: string; edits: TextEdit[] }
  /** What an agent is doing (src/server/activity.ts); `by` names its thread. */
  | { type: "activity"; by: string; threadId: string; activity: Activity };
/** A window's answer to a request. `code: "no-window"`: nothing on screen to do it in. */
export type BridgeResult = { ok: boolean; detail: string; code?: "no-window" };

const MAX_BODY = 512 * 1024;
/** Unix socket paths top out near 104 bytes on macOS. */
const MAX_SOCKET_PATH = 100;

/**
 * A socket path for one bridge: in the workspace's folder, or a short one in
 * tmp when that's too long. Each bridge gets its own name: while the plugin
 * reloads, its old and new copies both run, and closing a Unix socket server
 * removes the file at its path, which must not be the new copy's.
 */
export function bridgeSocketPath(dir: string, id: string, nonce = randomUUID().slice(0, 8)): string {
  const inside = join(dir, `bridge-${nonce}.sock`);
  if (inside.length < MAX_SOCKET_PATH) return inside;
  // tmpdir can be long too (macOS: /var/folders/…/T/); /tmp always exists on macOS and Linux.
  const name = `scb-${createHash("sha256").update(`${dir}\0${id}\0${nonce}`).digest("hex").slice(0, 16)}.sock`;
  const temp = join(tmpdir(), name);
  return temp.length < MAX_SOCKET_PATH ? temp : join("/tmp", name);
}

/**
 * One VS Code window (a browser tab or frame) connected to a workspace's
 * bridge. Its extension host runs in code-server and outlives a closed tab
 * for a while, so a connected window can have no screen: `stale` marks one
 * that didn't answer, until the user is in it again.
 */
type Window = { stream: ServerResponse | null; state: EditorState | null; usedAt: number; stale?: boolean };
type Bridge = { server: Server; socket: string; windows: Map<string, Window>; heartbeat?: ReturnType<typeof setInterval> };

export class Bridges {
  /** `log`: an editor window connected or left (each VS Code page load connects once). */
  constructor(private readonly log: (message: string) => void = () => undefined) {}

  private readonly bridges = new Map<string, Bridge>();
  /** A command for an editor that isn't connected yet, delivered when it connects. */
  private readonly held = new Map<string, BridgeCommand>();
  private readonly waiting = new Map<string, (result: BridgeResult) => void>();

  /** Starts a workspace's bridge and returns its socket path. */
  async open(id: string, dir: string): Promise<string> {
    await this.close(id);
    const socket = bridgeSocketPath(dir, id);
    await rm(socket, { force: true });
    const bridge: Bridge = { server: createServer((req, res) => this.handle(id, req, res)), socket, windows: new Map() };
    // Keeps event streams open through idle proxies and notices dead ones.
    bridge.heartbeat = setInterval(() => { for (const window of bridge.windows.values()) window.stream?.write(": ping\n\n"); }, 25_000);
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
    for (const window of bridge.windows.values()) window.stream?.end();
    // Closing removes the socket file too.
    await new Promise<void>((resolve) => bridge.server.close(() => resolve()));
    await rm(bridge.socket, { force: true });
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.bridges.keys()].map((id) => this.close(id)));
  }

  /** The connected window the user used last: the one the agent talks to. */
  private current(id: string): Window | null {
    const open = [...(this.bridges.get(id)?.windows.values() ?? [])].filter((window) => window.stream && !window.stale);
    return open.sort((a, b) => b.usedAt - a.usedAt)[0] ?? null;
  }

  /** What that window last reported. */
  state(id: string): EditorState | null {
    return this.current(id)?.state ?? null;
  }

  /** Files any window, live or not, last reported unsaved: never write these on disk. */
  unsaved(id: string): string[] {
    return [...new Set([...(this.bridges.get(id)?.windows.values() ?? [])].flatMap((window) => window.state?.unsavedFiles ?? []))];
  }

  /** Whether a VS Code window is listening. */
  connected(id: string): boolean {
    return this.current(id) !== null;
  }

  /** Sends a command to the current window; held for the next editor to connect when none is. Returns whether it went now. */
  send(id: string, command: BridgeCommand): boolean {
    const window = this.current(id);
    if (!window?.stream) {
      this.held.set(id, command);
      return false;
    }
    this.held.delete(id);
    window.stream.write(`data: ${JSON.stringify(command)}\n\n`);
    return true;
  }

  /** Sends a passing notice to the current window; dropped when none is open. */
  notify(id: string, command: BridgeCommand): boolean {
    const window = this.current(id);
    if (!window?.stream) return false;
    window.stream.write(`data: ${JSON.stringify(command)}\n\n`);
    return true;
  }

  /** Whether any workspace has an editor open. */
  anyConnected(): boolean {
    return [...this.bridges.keys()].some((id) => this.connected(id));
  }

  /**
   * Sends a command and waits for the window's answer. Null when no window is
   * open, so the caller can act without one.
   */
  request(id: string, command: BridgeCommand, timeoutMs: number): Promise<BridgeResult | null> {
    const window = this.current(id);
    if (!window?.stream) return Promise.resolve(null);
    const requestId = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiting.delete(requestId);
        window.stale = true;
        resolve({ ok: false, detail: "The editor didn't answer in time." });
      }, timeoutMs);
      this.waiting.set(requestId, (result) => {
        clearTimeout(timer);
        this.waiting.delete(requestId);
        if (result.code === "no-window") window.stale = true;
        resolve(result);
      });
      window.stream!.write(`data: ${JSON.stringify({ ...command, requestId })}\n\n`);
    });
  }

  private handle(id: string, req: IncomingMessage, res: ServerResponse): void {
    const bridge = this.bridges.get(id);
    if (!bridge) { res.writeHead(410).end(); return; }
    const url = new URL(req.url ?? "/", "http://bridge");
    const windowId = (url.searchParams.get("window") ?? req.headers["x-window"]?.toString() ?? "default").slice(0, 100);
    if (req.method === "GET" && url.pathname === "/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write(": connected\n\n");
      const window = bridge.windows.get(windowId) ?? { stream: null, state: null, usedAt: 0 };
      window.stream = res;
      window.usedAt = Date.now();
      bridge.windows.set(windowId, window);
      const opened = Date.now();
      const count = () => [...bridge.windows.values()].filter((each) => each.stream).length;
      this.log(`workspace ${id}: editor window connected (${count()} open)`);
      req.on("close", () => {
        if (window.stream === res) bridge.windows.delete(windowId);
        this.log(`workspace ${id}: editor window left after ${Math.round((Date.now() - opened) / 1000)}s (${count()} open)`);
      });
      const held = this.held.get(id);
      if (held) this.send(id, held);
      return;
    }
    if (req.method !== "POST" || (url.pathname !== "/state" && url.pathname !== "/result")) { res.writeHead(404).end(); return; }
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
      if (url.pathname === "/result") {
        const result = resultSchema.safeParse(parsed);
        if (!result.success) { res.writeHead(400).end(); return; }
        this.waiting.get(result.data.requestId)?.({ ok: result.data.ok, detail: result.data.detail, ...(result.data.code ? { code: result.data.code } : {}) });
        res.writeHead(204).end();
        return;
      }
      const result = editorStateSchema.safeParse(parsed);
      if (!result.success) { res.writeHead(400).end(); return; }
      const window = bridge.windows.get(windowId) ?? { stream: null, state: null, usedAt: 0 };
      window.state = result.data;
      // The window in focus is the one the user is using, and has a screen.
      if (result.data.focused) { window.usedAt = Date.now(); window.stale = false; }
      bridge.windows.set(windowId, window);
      res.writeHead(204).end();
    });
  }
}

const resultSchema = z.object({ requestId: z.string().max(100), ok: z.boolean(), detail: z.string().max(2000), code: z.literal("no-window").optional() });

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
    if (!lines.length) lines.push("- No file open right now.");
    return [`The user has VS Code workspace "${title}" open beside this chat${state.focused ? " and is in it now" : ""}:\n${lines.join("\n")}`];
  });
  if (!parts.length) return null;
  return `${parts.join("\n\n")}\n\nWhen they say "this" or "here", they likely mean their selection or the file above. To point them at code, call code_show with a path and lines; their editor opens there. To change a file they have open, prefer code_edit: they watch it typed into their editor, and it merges with their unsaved changes. code_editor_state gives the latest view mid-turn.`;
}
