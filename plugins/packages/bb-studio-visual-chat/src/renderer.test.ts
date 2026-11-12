// canvas.renderer (the board renderer for the iOS app) and the client hint on create and send.
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clientNote } from "./instructions";
import { CANVAS_MIGRATIONS } from "./migrations";
import { RENDERER_FILE, rendererDirs, rendererVersion } from "./renderer";
import { registerCanvas } from "./server";

type Part = { text: string; visibility?: string };

function host(rendererDirsOverride?: string[]) {
  const spawned: { input: Part[] }[] = [];
  const sent: { input: Part[] }[] = [];
  let next = 0;
  const fake = createFakePluginHost({
    pluginId: "studio-visual-chat",
    sdk: {
      threads: {
        spawn: async (input: unknown) => { spawned.push(input as { input: Part[] }); return { id: `thr_vc${++next}` }; },
        send: async (input: unknown) => { sent.push(input as { input: Part[] }); return { ok: true }; },
        update: async () => ({ ok: true }),
        events: { list: async () => [] },
      },
    },
  } as never);
  const db = fake.bb.storage.database();
  for (const migration of CANVAS_MIGRATIONS) db.exec(migration);
  registerCanvas(fake.bb, db, { streamIntervalMs: 2, ...(rendererDirsOverride ? { rendererDirs: rendererDirsOverride } : {}) });
  const call = (method: string, input: unknown) => fake.harness.behavior.callRpc(method, input) as Promise<any>;
  return { call, spawned, sent };
}

describe("canvas.renderer", () => {
  it("serves the committed bundle with its hash as the version, the same on every call and every server", async () => {
    const built = readFileSync(join(rendererDirs()[0]!, RENDERER_FILE), "utf8");
    const a = await host().call("canvas.renderer", null);
    expect(a).toEqual({ version: rendererVersion(built), js: built });
    expect(a.version).toMatch(/^[0-9a-f]{16}$/);
    const b = await host().call("canvas.renderer", { version: null });
    expect(b.version).toBe(a.version);
    expect(b.js).toBe(built);
  });

  it("answers no text when the caller already has the current version, and the text for any other", async () => {
    const { call } = host();
    const { version } = await call("canvas.renderer", null);
    expect(await call("canvas.renderer", { version })).toEqual({ version, js: null });
    expect((await call("canvas.renderer", { version: "0000000000000000" })).js).toContain("BBCanvasRenderer");
  });

  it("gets a new version when the build changes, and says how to build a missing one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vc-renderer-"));
    writeFileSync(join(dir, RENDERER_FILE), "globalThis.BBCanvasRenderer={protocol:1};");
    const first = await host([dir]).call("canvas.renderer", null);
    writeFileSync(join(dir, RENDERER_FILE), "globalThis.BBCanvasRenderer={protocol:1};//2");
    const second = await host([dir]).call("canvas.renderer", null);
    expect(second.version).not.toBe(first.version);
    await expect(host([join(dir, "missing")]).call("canvas.renderer", null)).rejects.toThrow(/build-ui\.mjs/);
  });
});

describe("the client hint", () => {
  const phone = { kind: "duo-folded", width: 466, height: 678 } as const;

  it("is one short line", () => {
    expect(clientNote({ kind: "phone", width: 402, height: 760 })).toBe("The user is on a phone, ~402×760: compose to stack cleanly below 700px.");
    expect(clientNote(phone)).toBe("The user is on a phone (a folded Surface Duo), ~466×678: compose to stack cleanly below 700px.");
    expect(clientNote({ kind: "desktop", width: 1280, height: 800 })).toBe("The user is on a desktop, ~1280×800.");
    expect(clientNote(null)).toBe("");
  });

  it("reaches the agent, agent only, with the first message and with each message after", async () => {
    const { call, spawned, sent } = host();
    const { threadId } = await call("canvas.create", { text: "Retro game stores near me", client: phone });
    const first = spawned[0]!.input;
    expect(first[0]).toMatchObject({ text: "Retro game stores near me" });
    expect(first[1]).toEqual({ type: "text", text: clientNote(phone), mentions: [], visibility: "agent-only" });
    expect(first[2]!.text).toContain("DESIGN GUIDE");
    await call("canvas.send", { threadId, text: "Which are open now?", client: phone });
    expect(sent[0]!.input.map((part) => part.text)).toEqual(["Which are open now?", clientNote(phone)]);
    expect(sent[0]!.input[1]!.visibility).toBe("agent-only");
  });

  it("adds nothing for a client that doesn't send one (the desktop page)", async () => {
    const { call, spawned, sent } = host();
    const { threadId } = await call("canvas.create", { text: "Hello" });
    expect(spawned[0]!.input).toHaveLength(2);
    await call("canvas.send", { threadId, text: "Next" });
    expect(sent[0]!.input.map((part) => part.text)).toEqual(["Next"]);
  });

  it("refuses a malformed hint", async () => {
    const { call } = host();
    await expect(call("canvas.create", { text: "Hi", client: { kind: "watch", width: 200, height: 200 } })).rejects.toThrow();
    await expect(call("canvas.create", { text: "Hi", client: { kind: "phone", width: 1e9, height: 600 } })).rejects.toThrow();
  });
});
