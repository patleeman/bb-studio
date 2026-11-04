import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { CANVAS_MIGRATIONS } from "./migrations";
import { registerCanvas } from "./server";
import { CANVAS_CHANNEL } from "./shared";
import { canvasVoiceTools, CANVAS_TOOL_NAMES } from "./tools";

type Sent = { threadId: string; input: { text: string; visibility?: string }[]; mode?: string };

function canvasHost() {
  const spawned: Record<string, unknown>[] = [];
  const sent: Sent[] = [];
  let next = 0;
  const host = createFakePluginHost({
    pluginId: "studio",
    sdk: {
      threads: {
        spawn: async (input: unknown) => { spawned.push(input as Record<string, unknown>); return { id: `thr_canvas${++next}` }; },
        send: async (input: unknown) => { sent.push(input as Sent); return { ok: true }; },
      },
    },
  });
  const db = host.bb.storage.database();
  db.exec(CANVAS_MIGRATIONS[0]!);
  const canvas = registerCanvas(host.bb, db);
  const call = (method: string, input: unknown) => host.harness.behavior.callRpc(method, input) as Promise<any>;
  const tool = (name: string, input: unknown, threadId: string) => host.harness.behavior.callAgentTool(name, input, { threadId });
  return { host, canvas, spawned, sent, call, tool };
}

const text = (result: unknown): string => typeof result === "string" ? result : JSON.stringify(result);

describe("canvas threads", () => {
  it("creates a hidden thread in the personal project with the rules as an agent-only note", async () => {
    const { call, spawned } = canvasHost();
    const { threadId, canvasId } = await call("canvas.create", { text: "How did yesterday's election go?" });
    expect(threadId).toBe("thr_canvas1");
    expect(spawned[0]).toMatchObject({ projectId: "proj_personal", visibility: "hidden", pluginMetadata: { canvas: canvasId } });
    const input = spawned[0]!.input as { text: string; visibility?: string }[];
    expect(input[0]).toMatchObject({ text: "How did yesterday's election go?" });
    expect(input[1]!.visibility).toBe("agent-only");
    expect(input[1]!.text).toContain("Remove what no longer matters.");
    const { canvas } = await call("canvas.get", { threadId });
    expect(canvas).toMatchObject({ threadId, status: "working", turn: 1, items: [] });
    expect(canvas.history).toEqual([expect.objectContaining({ role: "user", text: "How did yesterday's election go?" })]);
  });

  it("sends the user's next message to the thread, queued while it works", async () => {
    const { call, sent } = canvasHost();
    const { threadId } = await call("canvas.create", { text: "Election results" });
    await call("canvas.send", { threadId, text: "Drill into Pennsylvania" });
    expect(sent).toEqual([expect.objectContaining({ threadId, mode: "queue-if-active" })]);
    expect((await call("canvas.get", { threadId })).canvas.turn).toBe(2);
  });

  it("turns the thread's reply into the caption when it goes idle", async () => {
    const { host, call } = canvasHost();
    const { threadId } = await call("canvas.create", { text: "Election results" });
    await host.harness.behavior.emitThreadEvent("thread.idle", { thread: { id: threadId } as never, lastAssistantText: "Democrats took the House; the Senate stays close.\n\n::next{reply=\"More\"}" });
    const { canvas } = await call("canvas.get", { threadId });
    expect(canvas).toMatchObject({ status: "idle", caption: "Democrats took the House; the Senate stays close." });
    expect(canvas.history.at(-1)).toMatchObject({ role: "agent" });
  });

  it("gives canvas threads their tools and rules, and nothing to other threads' check", async () => {
    const { canvas, call } = canvasHost();
    const { threadId, canvasId } = await call("canvas.create", { text: "Hi" });
    expect(canvas.isCanvasThread(threadId)).toBe(true);
    expect(canvas.isCanvasThread("thr_other")).toBe(false);
    // Before Studio records the thread, its metadata already says so.
    expect(canvas.isCanvasThread("thr_new", { canvas: canvasId })).toBe(true);
    expect(canvas.instructions).toContain("On a topic change, clear and rebuild");
  });
});

describe("canvas tools", () => {
  it("edits only the calling thread's board, and publishes each edit", async () => {
    const { host, call, tool } = canvasHost();
    const { threadId } = await call("canvas.create", { text: "Election" });
    const before = host.harness.inspection.realtimeSignals.length;
    const added = await tool("canvas_add", { items: [{ id: "headline", kind: "headline", data: { text: "Democrats take the House" }, importance: 5 }, { kind: "stat", title: "Turnout", data: { value: 51 } }] }, threadId);
    expect(text(added)).toContain("Added headline");
    expect(text(added)).toContain("the focus is headline");
    expect(host.harness.inspection.realtimeSignals.slice(before)).toContainEqual(expect.objectContaining({ channel: CANVAS_CHANNEL }));
    const { canvas } = await call("canvas.get", { threadId });
    expect(canvas.items.map((item: { id: string }) => item.id).sort()).toEqual(["headline", "turnout"]);
    expect(canvas.changes.map((change: { by: string }) => change.by)).toEqual(["agent", "agent"]);
  });

  it("refuses a thread that isn't a canvas", async () => {
    const { tool } = canvasHost();
    const result = await tool("canvas_add", { items: [{ kind: "stat", data: 1 }] }, "thr_somewhere_else") as { isError?: boolean; content?: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("isn't a canvas");
  });

  it("keeps two canvases' boards apart", async () => {
    const { call, tool } = canvasHost();
    const a = await call("canvas.create", { text: "A" });
    const b = await call("canvas.create", { text: "B" });
    await tool("canvas_add", { items: [{ id: "only-a", kind: "stat", data: 1 }] }, a.threadId);
    await tool("canvas_clear", {}, b.threadId);
    expect((await call("canvas.get", { threadId: a.threadId })).canvas.items).toHaveLength(1);
    expect((await call("canvas.get", { threadId: b.threadId })).canvas.items).toHaveLength(0);
  });

  it("validates kinds, shapes and sizes, and changes nothing on a bad call", async () => {
    const { call, tool } = canvasHost();
    const { threadId } = await call("canvas.create", { text: "Election" });
    await expect(tool("canvas_add", { items: [{ kind: "spreadsheet", data: [] }] }, threadId)).rejects.toThrow();
    await expect(tool("canvas_add", { items: [{ id: "Bad Id!", kind: "stat", data: 1 }] }, threadId)).rejects.toThrow();
    const headless = await tool("canvas_add", { items: [{ kind: "headline", data: { subtitle: "no text" } }] }, threadId) as { isError?: boolean; content?: { text: string }[] };
    expect(headless.isError).toBe(true);
    expect(headless.content?.[0]?.text).toContain("A headline needs data");
    const html = await tool("canvas_add", { items: [{ kind: "stat", data: 1, html: "<b>no</b>" }] }, threadId) as { isError?: boolean };
    expect(html.isError).toBe(true);
    const huge = await tool("canvas_add", { items: [{ kind: "table", data: [{ text: "x".repeat(70 * 1024) }] }] }, threadId) as { isError?: boolean; content?: { text: string }[] };
    expect(huge.content?.[0]?.text).toContain("over 64 KB");
    // Dashboards' embed reads Studio's RPCs, which the canvas plugin's page can't: not a canvas kind.
    await expect(tool("canvas_add", { items: [{ kind: "embed", options: { href: "/plugins/studio/studio/minis/mini_1" } }] }, threadId)).rejects.toThrow();
    expect((await call("canvas.get", { threadId })).canvas).toMatchObject({ rev: 0, items: [] });
  });

  it("replaces the board in one step with canvas_set, and reads it back", async () => {
    const { call, tool } = canvasHost();
    const { threadId } = await call("canvas.create", { text: "Election" });
    await tool("canvas_add", { items: [{ id: "house", kind: "stat", data: 220 }, { id: "senate", kind: "stat", data: 51 }] }, threadId);
    await tool("canvas_set", { items: [{ id: "weather", kind: "headline", data: "Sunny weekend in NYC", importance: 5 }, { id: "temps", kind: "line", data: [{ day: "Sat", high: 61 }, { day: "Sun", high: 58 }] }] }, threadId);
    const read = text(await tool("canvas_read", {}, threadId));
    expect(read).toContain("weather: headline");
    expect(read).toContain("(focus)");
    expect(read).toContain("Removed stat \"house\"");
    expect(read).not.toMatch(/- house:/);
  });
});

describe("voice", () => {
  it("offers the canvas tools only to a session launched from a canvas thread", async () => {
    const { canvas, call } = canvasHost();
    const { threadId } = await call("canvas.create", { text: "Election" });
    expect(canvas.voice.tools(threadId).map((each) => each.name)).toEqual([...CANVAS_TOOL_NAMES]);
    expect(canvas.voice.tools("thr_other")).toEqual([]);
    expect(canvas.voice.tools(null)).toEqual([]);
  });

  it("runs the voice's canvas calls on that canvas, as the voice", async () => {
    const { canvas, call } = canvasHost();
    const { threadId } = await call("canvas.create", { text: "Election" });
    expect(canvas.voice.run(threadId, "canvas_add", { items: [{ id: "pa", kind: "stat", title: "Pennsylvania", data: { value: "D +1.8" } }] })).toContain("Added stat");
    expect(canvas.voice.run(threadId, "loops_list", {})).toBeNull();
    expect(canvas.voice.run("thr_other", "canvas_add", { items: [] })).toContain("isn't speaking for a canvas");
    expect((await call("canvas.get", { threadId })).canvas.changes.at(-1)).toMatchObject({ by: "voice", itemId: "pa" });
  });

  it("describes its parameters as plain JSON Schema objects", () => {
    for (const each of canvasVoiceTools()) {
      expect(each.parameters.type).toBe("object");
      expect(JSON.stringify(each.parameters)).not.toContain("$schema");
    }
  });
});

describe("for Studio's hands-free voice (canvas.voice, canvas.voiceRun)", () => {
  it("offers the tools and a note only for a canvas thread, and runs them on its board", async () => {
    const { call } = canvasHost();
    const { threadId } = await call("canvas.create", { text: "Election" });
    const offered = await call("canvas.voice", { threadId });
    expect(offered.tools.map((tool: { name: string }) => tool.name)).toEqual([...CANVAS_TOOL_NAMES]);
    expect(offered.instructions).toContain("You are speaking on a canvas");
    expect(await call("canvas.voice", { threadId: "thr_other" })).toEqual({ tools: [], instructions: null });
    expect((await call("canvas.voiceRun", { threadId, name: "canvas_add", args: { items: [{ id: "pa", kind: "stat", data: 1 }] } })).output).toContain("Added stat");
    expect((await call("canvas.voiceRun", { threadId, name: "loops_list", args: {} })).output).toBeNull();
    expect((await call("canvas.get", { threadId })).canvas.changes.at(-1)).toMatchObject({ by: "voice", itemId: "pa" });
  });
});
