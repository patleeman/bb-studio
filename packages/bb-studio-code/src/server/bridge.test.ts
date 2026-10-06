import { request } from "node:http";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Bridges, bridgeSocketPath, editorContext } from "./bridge";
import type { EditorState } from "../shared";

let dir = "";
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), "scb-")); });
afterAll(() => rm(dir, { recursive: true, force: true }));

function call(socketPath: string, method: string, path: string, body?: unknown): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, method, path, headers: { "content-type": "application/json" } }, (res) => {
      let text = "";
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

/** Opens the event stream and resolves with the first event. */
function nextEvent(socketPath: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, path: "/events" }, (res) => {
      let buffer = "";
      res.on("data", (chunk) => {
        buffer += chunk;
        const match = /^data: (.*)$/m.exec(buffer);
        if (match) { resolve(JSON.parse(match[1]!)); req.destroy(); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

const state: EditorState = {
  focused: true,
  activeFile: {
    path: "/repo/src/retry.ts",
    language: "typescript",
    selection: { startLine: 12, startColumn: 1, endLine: 14, endColumn: 2 },
    selectedText: "if (attempt > MAX_ATTEMPTS) throw error;",
    visible: { startLine: 1, endLine: 40 },
    problems: [{ line: 14, severity: "error", message: "Cannot find name 'delay'." }],
  },
  openFiles: ["/repo/src/retry.ts", "/repo/src/queue.ts"],
  unsavedFiles: ["/repo/src/queue.ts"],
};

describe("bridge socket", () => {
  it("keeps the socket path short enough for Unix sockets, and private", async () => {
    expect(bridgeSocketPath(dir, "cws_1").length).toBeLessThan(104);
    expect(bridgeSocketPath(`/${"x".repeat(200)}`, "cws_1").length).toBeLessThan(104);
    const bridges = new Bridges();
    const socket = await bridges.open("cws_mode", dir);
    expect((await stat(socket)).mode & 0o777).toBe(0o600);
    await bridges.close("cws_mode");
  });

  it("stores what the editor reports, and refuses malformed reports", async () => {
    const bridges = new Bridges();
    const socket = await bridges.open("cws_state", dir);
    expect((await call(socket, "POST", "/state", state)).status).toBe(204);
    expect(bridges.state("cws_state")?.activeFile?.path).toBe("/repo/src/retry.ts");
    expect((await call(socket, "POST", "/state", { focused: "yes" })).status).toBe(400);
    await bridges.close("cws_state");
    expect(bridges.state("cws_state")).toBeNull();
  });

  it("sends commands to a connected editor, and holds one for an editor that connects later", async () => {
    const bridges = new Bridges();
    const socket = await bridges.open("cws_cmd", dir);
    expect(bridges.connected("cws_cmd")).toBe(false);
    // Nobody listening yet: held, then delivered on connect.
    bridges.send("cws_cmd", { type: "show", path: "/repo/a.ts", startLine: 3, endLine: 5 });
    await expect(nextEvent(socket)).resolves.toEqual({ type: "show", path: "/repo/a.ts", startLine: 3, endLine: 5 });
    await bridges.close("cws_cmd");
  });
});

describe("what the agent is told", () => {
  it("describes the file, lines, selection, problems and unsaved files, relative to the workspace", () => {
    const text = editorContext([{ title: "Orbit", folders: ["/repo"], state }]);
    expect(text).toContain('VS Code workspace "Orbit"');
    expect(text).toContain("src/retry.ts");
    expect(text).toContain("lines 1–40");
    expect(text).toContain("lines 12–14");
    expect(text).toContain("if (attempt > MAX_ATTEMPTS) throw error;");
    expect(text).toContain("line 14: Cannot find name 'delay'.");
    expect(text).toMatch(/unsaved[^\n]*src\/queue\.ts/i);
    expect(text).toMatch(/don't edit/i);
    expect(text).toContain("code_show");
  });

  it("says nothing when no editor is connected", () => {
    expect(editorContext([])).toBeNull();
  });
});

describe("bridge extension", () => {
  it("is valid JavaScript", async () => {
    const { BRIDGE_SOURCE } = await import("./bridge-extension");
    expect(() => new Function("require", "exports", "process", BRIDGE_SOURCE)).not.toThrow();
  });

  it("installs once, and replaces an older version", async () => {
    const { BRIDGE_ID, BRIDGE_VERSION, installBridge } = await import("./bridge-extension");
    const { mkdir, readdir, writeFile, readFile } = await import("node:fs/promises");
    const extensions = join(dir, "extensions");
    await mkdir(join(extensions, `${BRIDGE_ID}-0.0.1`), { recursive: true });
    await writeFile(join(extensions, "extensions.json"), JSON.stringify([{ identifier: { id: BRIDGE_ID }, version: "0.0.1" }, { identifier: { id: "other.ext" }, version: "1.0.0" }]));
    await installBridge(extensions);
    await installBridge(extensions);
    expect((await readdir(extensions)).filter((name) => name.startsWith(BRIDGE_ID))).toEqual([`${BRIDGE_ID}-${BRIDGE_VERSION}`]);
    expect(JSON.parse(await readFile(join(extensions, "extensions.json"), "utf8"))).toEqual([{ identifier: { id: "other.ext" }, version: "1.0.0" }]);
    expect(JSON.parse(await readFile(join(extensions, `${BRIDGE_ID}-${BRIDGE_VERSION}`, "package.json"), "utf8")).main).toBe("./extension.js");
  });
});
