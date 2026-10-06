import { request } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Bridges, editorContext } from "./bridge";
import { applyEdits } from "./edits";
import type { EditorState } from "../shared";

let dir = "";
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), "scl-")); });
afterAll(() => rm(dir, { recursive: true, force: true }));

const blank: EditorState = { focused: false, activeFile: null, openFiles: [], unsavedFiles: [] };

function post(socketPath: string, path: string, body: unknown, window?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, method: "POST", path, headers: { "content-type": "application/json", ...(window ? { "x-window": window } : {}) } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

/** A connected window that collects the commands it receives. */
function connect(socketPath: string, window: string): { events: unknown[]; close(): void; ready: Promise<void> } {
  const events: unknown[] = [];
  let close = () => undefined as void;
  const ready = new Promise<void>((resolve) => {
    const req = request({ socketPath, path: `/events?window=${window}` }, (res) => {
      let buffer = "";
      res.on("data", (chunk) => {
        buffer += chunk;
        let at: number;
        while ((at = buffer.indexOf("\n\n")) >= 0) {
          const event = buffer.slice(0, at);
          buffer = buffer.slice(at + 2);
          const match = /^data: (.*)$/m.exec(event);
          if (match) events.push(JSON.parse(match[1]!));
        }
      });
      resolve();
    });
    close = () => { req.destroy(); };
    req.end();
  });
  return { events, close: () => close(), ready };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("one window at a time", () => {
  it("sends commands only to the window the user used last", async () => {
    const bridges = new Bridges();
    const socket = await bridges.open("cws_win", dir);
    const a = connect(socket, "a");
    const b = connect(socket, "b");
    await Promise.all([a.ready, b.ready]);
    await post(socket, "/state", { ...blank, focused: true }, "a");
    await wait(20);
    await post(socket, "/state", { ...blank, focused: true }, "b");
    await wait(20);
    bridges.send("cws_win", { type: "show", path: "/x", startLine: 1, endLine: 1 });
    await wait(50);
    expect(a.events).toEqual([]);
    expect(b.events).toHaveLength(1);
    a.close(); b.close();
    await bridges.close("cws_win");
  });

  it("waits for the window's answer to a request", async () => {
    const bridges = new Bridges();
    const socket = await bridges.open("cws_req", dir);
    const a = connect(socket, "a");
    await a.ready;
    await post(socket, "/state", { ...blank, focused: true }, "a");
    const answer = bridges.request("cws_req", { type: "edit", path: "/x", edits: [{ oldText: "a", newText: "b" }] }, 2000);
    await wait(50);
    const sent = a.events[0] as { requestId: string };
    expect(sent.requestId).toBeTruthy();
    await post(socket, "/result", { requestId: sent.requestId, ok: true, detail: "Typed 1 edit." });
    await expect(answer).resolves.toEqual({ ok: true, detail: "Typed 1 edit." });
    a.close();
    await bridges.close("cws_req");
  });

  it("answers null at once when no window is open, and times out when one never answers", async () => {
    const bridges = new Bridges();
    const socket = await bridges.open("cws_none", dir);
    await expect(bridges.request("cws_none", { type: "edit", path: "/x", edits: [] }, 1000)).resolves.toBeNull();
    const a = connect(socket, "a");
    await a.ready;
    await expect(bridges.request("cws_none", { type: "edit", path: "/x", edits: [] }, 100)).resolves.toEqual({ ok: false, detail: expect.stringMatching(/didn't answer/) });
    a.close();
    await bridges.close("cws_none");
  });
});

describe("edits on disk, when no editor is open", () => {
  it("replaces text that appears once", () => {
    expect(applyEdits("a\nb\nc\n", [{ oldText: "b", newText: "B" }])).toBe("a\nB\nc\n");
  });
  it("appends when oldText is empty", () => {
    expect(applyEdits("a\n", [{ oldText: "", newText: "b\n" }])).toBe("a\nb\n");
  });
  it("refuses text that's missing or appears more than once", () => {
    expect(() => applyEdits("a a", [{ oldText: "a", newText: "b" }])).toThrow(/more than once/);
    expect(() => applyEdits("a", [{ oldText: "z", newText: "b" }])).toThrow(/Couldn't find/);
  });
});

describe("the message with nothing open", () => {
  it("says VS Code is open with no file, instead of saying nothing", () => {
    const text = editorContext([{ title: "bb-studio", folders: ["/repo"], state: { ...blank, focused: true } }]);
    expect(text).toContain('VS Code workspace "bb-studio" open');
    expect(text).toMatch(/no file open/i);
  });
});

describe("a window that's gone", () => {
  it("stops counting a window that didn't answer, until it's in use again", async () => {
    const bridges = new Bridges();
    const socket = await bridges.open("cws_gone", dir);
    const a = connect(socket, "a");
    await a.ready;
    await post(socket, "/state", { ...blank, focused: true, unsavedFiles: ["/repo/a.ts"] }, "a");
    await expect(bridges.request("cws_gone", { type: "edit", path: "/x", edits: [] }, 100)).resolves.toMatchObject({ ok: false });
    // Still connected, but not answering: requests skip it.
    expect(bridges.connected("cws_gone")).toBe(false);
    await expect(bridges.request("cws_gone", { type: "edit", path: "/x", edits: [] }, 100)).resolves.toBeNull();
    // What it last said about unsaved files still counts.
    expect(bridges.unsaved("cws_gone")).toEqual(["/repo/a.ts"]);
    // In use again: it counts again.
    await post(socket, "/state", { ...blank, focused: true }, "a");
    expect(bridges.connected("cws_gone")).toBe(true);
    a.close();
    await bridges.close("cws_gone");
  });

  it("takes a window's own word that it has no screen", async () => {
    const bridges = new Bridges();
    const socket = await bridges.open("cws_noscreen", dir);
    const a = connect(socket, "a");
    await a.ready;
    await post(socket, "/state", { ...blank, focused: true }, "a");
    const answer = bridges.request("cws_noscreen", { type: "edit", path: "/x", edits: [] }, 2000);
    await wait(50);
    await post(socket, "/result", { requestId: (a.events[0] as { requestId: string }).requestId, ok: false, code: "no-window", detail: "No window." });
    await expect(answer).resolves.toEqual({ ok: false, code: "no-window", detail: "No window." });
    expect(bridges.connected("cws_noscreen")).toBe(false);
    a.close();
    await bridges.close("cws_noscreen");
  });

  it("lets code-server drop a closed tab's extension host within a minute, not three hours", async () => {
    const { codeServerArgs } = await import("./runtime");
    const args = codeServerArgs({ config: "/c", userData: "/u", extensions: "/e", cookieSuffix: "s", trusted: true, file: "/f" });
    const at = args.indexOf("--reconnection-grace-time");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(Number(args[at + 1])).toBeLessThanOrEqual(60);
  });
});

describe("two copies of the plugin during a reload", () => {
  it("doesn't delete a socket the new copy already took over", async () => {
    const { stat } = await import("node:fs/promises");
    const old = new Bridges();
    const fresh = new Bridges();
    await old.open("cws_reload", dir);
    const socket = await fresh.open("cws_reload", dir);
    await old.close("cws_reload");
    await expect(stat(socket)).resolves.toBeTruthy();
    const a = connect(socket, "a");
    await a.ready;
    expect(fresh.connected("cws_reload")).toBe(true);
    a.close();
    await fresh.close("cws_reload");
  });
});

describe("an editor connecting", () => {
  it("tells the plugin, so it can follow threads already working", async () => {
    const connected: string[] = [];
    const bridges = new Bridges(() => undefined, (id) => connected.push(id));
    const socket = await bridges.open("cws_hello", dir);
    const a = connect(socket, "a");
    await a.ready;
    await wait(20);
    expect(connected).toEqual(["cws_hello"]);
    a.close();
    await bridges.close("cws_hello");
  });
});

describe("BB's shortcuts from inside VS Code", () => {
  it("hands a key pressed in VS Code to the plugin, and refuses anything else", async () => {
    const keys: unknown[] = [];
    const bridges = new Bridges(() => undefined, () => undefined, (id, key) => keys.push({ id, ...key }));
    const socket = await bridges.open("cws_keys", dir);
    expect(await post(socket, "/key", { key: "k", code: "KeyK", mod: true, shift: false, alt: false })).toBe(204);
    expect(await post(socket, "/key", { key: "x".repeat(50), code: "KeyK", mod: true, shift: false, alt: false })).toBe(400);
    expect(keys).toEqual([{ id: "cws_keys", key: "k", code: "KeyK", mod: true, shift: false, alt: false }]);
    await bridges.close("cws_keys");
  });

  it("binds only BB's app-level shortcuts in VS Code", async () => {
    const { PASSED_KEYS, BRIDGE_SOURCE } = await import("./bridge-extension");
    const combos = PASSED_KEYS.map((each) => each.mac);
    expect(combos).toEqual(expect.arrayContaining(["cmd+k", "cmd+shift+o", "cmd+\\", "cmd+j", "cmd+shift+c", "cmd+1", "cmd+9"]));
    // Editing and VS Code's own palettes stay with VS Code.
    for (const kept of ["cmd+p", "cmd+shift+p", "cmd+w", "cmd+d", "cmd+/"]) expect(combos).not.toContain(kept);
    expect(BRIDGE_SOURCE).toContain("bbStudio.passKey");
  });
});
