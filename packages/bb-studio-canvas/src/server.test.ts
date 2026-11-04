import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { CANVAS_MIGRATIONS } from "./migrations";
import { CANVAS_DEFAULT_MODEL, registerCanvas, VOICE_START_NOTE } from "./server";
import { CANVAS_CHANNEL } from "./shared";
import { canvasVoiceTools, CANVAS_TOOL_NAMES } from "./tools";

type Sent = { threadId: string; input: { text: string; visibility?: string }[]; mode?: string };

function canvasHost() {
  const spawned: Record<string, unknown>[] = [];
  const sent: Sent[] = [];
  const updated: Record<string, unknown>[] = [];
  const listed: string[] = [];
  let next = 0;
  const host = createFakePluginHost({
    pluginId: "studio",
    sdk: {
      threads: {
        spawn: async (input: unknown) => { spawned.push(input as Record<string, unknown>); return { id: `thr_canvas${++next}` }; },
        send: async (input: unknown) => { sent.push(input as Sent); return { ok: true }; },
        update: async (input: unknown) => { updated.push(input as Record<string, unknown>); return { ok: true }; },
      },
      providers: {
        list: async () => [
          { id: "claude-code", displayName: "Claude Code", available: true },
          { id: "codex", displayName: "Codex", available: true },
          { id: "gone", displayName: "Gone", available: false },
          { id: "opencode", displayName: "OpenCode", available: true },
        ],
        models: async ({ providerId }: { providerId: string }) => {
          listed.push(providerId);
          if (providerId === "opencode") return { models: [], modelLoadError: { code: "auth_required", detail: "Sign in to OpenCode" } };
          return providerId === "codex"
            ? { models: [{ id: "gpt-6.1-sol", model: "gpt-6.1-sol", displayName: "GPT-6.1-Sol", isDefault: true, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ reasoningEffort: "low", description: "" }, { reasoningEffort: "medium", label: "Medium", description: "" }, { reasoningEffort: "high", description: "" }] }, { id: "gpt-6-luna", model: "gpt-6-luna", displayName: "GPT-6-Luna", isDefault: false, defaultReasoningEffort: "low", supportedReasoningEfforts: [{ reasoningEffort: "low", description: "" }] }], modelLoadError: null }
            : { models: [{ id: "claude-opus-5-5", displayName: "Opus 5.5", isDefault: true, defaultReasoningEffort: "", supportedReasoningEfforts: [] }, { id: "claude-haiku-5-5", displayName: "Haiku 5.5", isDefault: false, defaultReasoningEffort: "", supportedReasoningEfforts: [] }], modelLoadError: null };
        },
      },
    },
  } as never);
  const db = host.bb.storage.database();
  for (const migration of CANVAS_MIGRATIONS) db.exec(migration);
  const canvas = registerCanvas(host.bb, db);
  const call = (method: string, input: unknown) => host.harness.behavior.callRpc(method, input) as Promise<any>;
  const tool = (name: string, input: unknown, threadId: string) => host.harness.behavior.callAgentTool(name, input, { threadId });
  return { host, canvas, spawned, sent, updated, listed, call, tool };
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

  it("pins new canvas threads to Haiku on the canvas's own thread, unless the caller picks a model", async () => {
    const { call, spawned } = canvasHost();
    await call("canvas.create", { text: "Election" });
    expect(spawned[0]).toMatchObject({ providerId: "claude-code", model: "claude-haiku-5-5", executionInputSources: { providerId: "explicit", model: "explicit" } });
    expect(CANVAS_DEFAULT_MODEL).toEqual({ providerId: "claude-code", model: "claude-haiku-5-5" });
    await call("canvas.create", { text: "Weather", providerId: "codex", model: "gpt-5.5", reasoningLevel: "low" });
    expect(spawned[1]).toMatchObject({ providerId: "codex", model: "gpt-5.5", reasoningLevel: "low" });
    await call("canvas.create", { text: "Sports", providerId: "claude-code" });
    expect(spawned[2]).toMatchObject({ providerId: "claude-code" });
    expect(spawned[2]!.model).toBeUndefined();
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

  it("starts a canvas by voice with no message, and its [PASS] reply isn't a caption", async () => {
    const { host, call, spawned } = canvasHost();
    const { threadId } = await call("canvas.create", { voice: true });
    expect(JSON.stringify(spawned[0])).toContain(VOICE_START_NOTE);
    expect(spawned[0]).toMatchObject({ providerId: CANVAS_DEFAULT_MODEL.providerId, model: CANVAS_DEFAULT_MODEL.model });
    expect((await call("canvas.get", { threadId })).canvas).toMatchObject({ title: "Voice canvas", turn: 0, status: "idle" });
    await host.harness.behavior.emitThreadEvent("thread.idle", { thread: { id: threadId } as never, lastAssistantText: "[PASS]" });
    expect((await call("canvas.get", { threadId })).canvas.caption).toBeNull();
    await expect(call("canvas.create", {})).rejects.toThrow();
  });

  it("gives canvas threads their tools and rules, and nothing to other threads' check", async () => {
    const { canvas, call } = canvasHost();
    const { threadId, canvasId } = await call("canvas.create", { text: "Hi" });
    expect(canvas.isCanvasThread(threadId)).toBe(true);
    expect(canvas.isCanvasThread("thr_other")).toBe(false);
    // Before Studio records the thread, its metadata already says so.
    expect(canvas.isCanvasThread("thr_new", { canvas: canvasId })).toBe(true);
    expect(canvas.instructionsFor(threadId)).toContain("On a topic change, clear and rebuild");
  });

  it("starts a canvas in editorial (or the style asked for), with the whole guide and the current style in its instructions", async () => {
    const { call, canvas, spawned } = canvasHost();
    const first = await call("canvas.create", { text: "Election" });
    const second = await call("canvas.create", { text: "Weather", look: "field" });
    expect((await call("canvas.get", { threadId: first.threadId })).canvas.look).toBe("editorial");
    expect((await call("canvas.get", { threadId: second.threadId })).canvas.look).toBe("field");
    const note = (spawned[1]!.input as { text: string }[])[1]!.text;
    for (const style of ["Style: Editorial.", "Style: Field notes.", "Style: Instrument.", "CHOOSING THE STYLE", "Singling out:", "Switching:"]) expect(note).toContain(style);
    expect(note).toContain("cv.render(");
    expect(note).not.toContain("@@");
    expect(canvas.instructionsFor(second.threadId)).toContain("This board is field (Field notes) now.");
    // Before the thread is attached, the metadata finds the canvas.
    expect(canvas.instructionsFor("thr_new", { canvas: second.canvasId })).toContain("This board is field");
    expect(canvas.instructionsFor("thr_unknown")).not.toContain("Board style");
  });

  it("lets the agent pick and switch the board's style, logged with its reason", async () => {
    const { call, tool } = canvasHost();
    const { threadId } = await call("canvas.create", { text: "Plan a trip" });
    const set = text(await tool("canvas_set", { style: "field", styleReason: "planning a trip", items: [{ id: "days", kind: "list", data: ["Sat", "Sun"] }] }, threadId));
    expect(set).toContain("Style: Field notes (planning a trip)");
    let view = (await call("canvas.get", { threadId })).canvas;
    expect(view.look).toBe("field");
    expect(view.changes.map((change: { op: string }) => change.op)).toEqual(["style", "add"]);
    // The same style again isn't logged twice.
    await tool("canvas_style", { style: "field" }, threadId);
    expect((await call("canvas.get", { threadId })).canvas.changes.filter((change: { op: string }) => change.op === "style")).toHaveLength(1);
    await tool("canvas_style", { style: "instrument", reason: "the user asked for a dashboard" }, threadId);
    view = (await call("canvas.get", { threadId })).canvas;
    expect(view).toMatchObject({ look: "instrument", items: [expect.objectContaining({ id: "days" })] });
    await tool("canvas_clear", { style: "editorial" }, threadId);
    view = (await call("canvas.get", { threadId })).canvas;
    expect(view).toMatchObject({ look: "editorial", items: [] });
    expect(text(await tool("canvas_read", {}, threadId))).toContain("Style: editorial (Editorial)");
    await expect(tool("canvas_style", { style: "classic" }, threadId)).rejects.toThrow(/Invalid option/);
  });

  it("logs the agent's first style pick even when the canvas already started in it", async () => {
    const { call, tool } = canvasHost();
    const { threadId } = await call("canvas.create", { text: "Election" });
    await tool("canvas_set", { style: "editorial", styleReason: "it's news", items: [{ kind: "headline", data: "Results" }] }, threadId);
    expect((await call("canvas.get", { threadId })).canvas.changes[0].summary).toBe("Style: Editorial (it's news)");
  });

  it("returns the look's design guide from canvas_guide", async () => {
    const { call, tool } = canvasHost();
    const { threadId } = await call("canvas.create", { text: "Ops", look: "instrument" });
    expect(text(await tool("canvas_guide", {}, threadId))).toContain("Style: Field notes.");
    const one = text(await tool("canvas_guide", { style: "instrument" }, threadId));
    expect(one).toContain("Style: Instrument.");
    expect(one).not.toContain("Style: Field notes.");
  });
});

describe("the model picker", () => {
  it("lists BB's available providers and their models, with reasoning levels only when there's a choice", async () => {
    const { call, listed } = canvasHost();
    const { providers } = await call("canvas.models", null);
    expect(providers.map((provider: { id: string }) => provider.id)).toEqual(["claude-code", "codex", "opencode"]);
    const codex = providers.find((provider: { id: string }) => provider.id === "codex");
    expect(codex.models[0]).toEqual({ id: "gpt-6.1-sol", name: "GPT-6.1-Sol", isDefault: true, reasoningLevels: [{ id: "low", label: "low" }, { id: "medium", label: "Medium" }, { id: "high", label: "high" }], defaultReasoningLevel: "medium" });
    expect(codex.models[1]).toMatchObject({ id: "gpt-6-luna", reasoningLevels: [], defaultReasoningLevel: null });
    expect(providers.find((provider: { id: string }) => provider.id === "claude-code").models[1]).toMatchObject({ id: "claude-haiku-5-5", name: "Haiku 5.5", reasoningLevels: [] });
    expect(providers.find((provider: { id: string }) => provider.id === "opencode")).toMatchObject({ error: "Sign in to OpenCode", models: [] });
    // Listed again only after a minute.
    await call("canvas.models", null);
    expect(listed).toHaveLength(3);
  });

  it("records new canvases on Haiku, and a same-provider pick changes the thread's model in place", async () => {
    const { call, spawned, updated } = canvasHost();
    const { threadId } = await call("canvas.create", { text: "Election" });
    expect((await call("canvas.get", { threadId })).canvas.execution).toEqual({ providerId: "claude-code", model: "claude-haiku-5-5", reasoningLevel: null });
    const result = await call("canvas.setModel", { threadId, providerId: "claude-code", model: "claude-opus-5-5" });
    expect(result.mode).toBe("same-thread");
    expect(updated).toEqual([{ threadId, model: "claude-opus-5-5", reasoningLevel: null }]);
    expect(result.canvas).toMatchObject({ threadId, execution: { providerId: "claude-code", model: "claude-opus-5-5" }, pendingExecution: null });
    expect(spawned).toHaveLength(1);
    expect((await call("canvas.setModel", { threadId, providerId: "claude-code", model: "claude-opus-5-5" })).mode).toBe("unchanged");
  });

  it("switches provider with a fresh thread on the next message, keeping the board, and old links still find it", async () => {
    const { call, tool, spawned, sent, updated } = canvasHost();
    const { threadId, canvasId } = await call("canvas.create", { text: "Election" });
    await tool("canvas_set", { style: "editorial", items: [{ id: "lead", kind: "headline", data: "Democrats take both chambers" }] }, threadId);
    const picked = await call("canvas.setModel", { threadId, providerId: "codex", model: "gpt-6.1-sol", reasoningLevel: "low" });
    expect(picked).toMatchObject({ mode: "new-thread-next-turn", canvas: { execution: { providerId: "claude-code" }, pendingExecution: { providerId: "codex", model: "gpt-6.1-sol", reasoningLevel: "low" } } });
    expect(updated).toEqual([]);
    const reply = await call("canvas.send", { threadId, text: "Drill into the closest races" });
    expect(reply).toEqual({ ok: true, threadId: "thr_canvas2" });
    expect(sent).toEqual([]);
    expect(spawned[1]).toMatchObject({ providerId: "codex", model: "gpt-6.1-sol", reasoningLevel: "low", visibility: "hidden", pluginMetadata: { canvas: canvasId } });
    const input = spawned[1]!.input as { text: string; visibility?: string }[];
    expect(input[0]).toMatchObject({ text: "Drill into the closest races" });
    expect(input[1]!.visibility).toBe("agent-only");
    expect(input[1]!.text).toContain("moved to this thread from another model");
    expect(input[1]!.text).toContain("lead: headline");
    expect(input[1]!.text).toContain("User: Election");
    const now = (await call("canvas.get", { threadId: "thr_canvas2" })).canvas;
    expect(now).toMatchObject({ id: canvasId, threadId: "thr_canvas2", execution: { providerId: "codex", model: "gpt-6.1-sol", reasoningLevel: "low" }, pendingExecution: null, items: [expect.objectContaining({ id: "lead" })] });
    // The old thread's address still finds the canvas, and its messages go to the new thread.
    expect((await call("canvas.get", { threadId })).canvas.id).toBe(canvasId);
    expect((await call("canvas.send", { threadId, text: "And the Senate?" })).threadId).toBe("thr_canvas2");
    expect(sent.at(-1)).toMatchObject({ threadId: "thr_canvas2" });
    // The new thread's tools edit the same board.
    expect(text(await tool("canvas_read", {}, "thr_canvas2"))).toContain("lead: headline");
  });

  it("drops a waiting provider switch when the current model is picked again", async () => {
    const { call, spawned } = canvasHost();
    const { threadId } = await call("canvas.create", { text: "Election" });
    await call("canvas.setModel", { threadId, providerId: "codex", model: "gpt-6-luna" });
    const back = await call("canvas.setModel", { threadId, providerId: "claude-code", model: "claude-haiku-5-5" });
    expect(back).toMatchObject({ mode: "unchanged", canvas: { pendingExecution: null } });
    await call("canvas.send", { threadId, text: "Next" });
    expect(spawned).toHaveLength(1);
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

  it("refuses a note with a clear error, and strips leftover anchor, point and relatedTo fields", async () => {
    const { call, tool, canvas } = canvasHost();
    const { threadId } = await call("canvas.create", { text: "Election" });
    await expect(tool("canvas_add", { items: [{ kind: "note", data: "Flipped" }] }, threadId)).rejects.toThrow(/notes aren't supported; put the point in a caption or the item itself/);
    await expect(tool("canvas_set", { items: [{ id: "why", kind: "note", data: "Flipped", anchor: "map" }] }, threadId)).rejects.toThrow(/notes aren't supported/);
    expect(canvas.voice.run(threadId, "canvas_add", { items: [{ kind: "note", data: "Flipped" }] })).toMatch(/^Nothing changed: items\.0\.kind: notes aren't supported/);
    expect(canvas.voice.run(threadId, "canvas_update", { items: [{ id: "map", kind: "note" }] })).toMatch(/notes aren't supported/);
    expect((await call("canvas.get", { threadId })).canvas).toMatchObject({ rev: 0, items: [] });
    // An older turn's item with link fields still lands, without them.
    await tool("canvas_add", { items: [{ id: "map", kind: "map", data: { PA: 2 } }, { id: "quote", kind: "quote", data: "Every vote", relatedTo: ["map"], anchor: "map", point: { x: 0.5, y: 0.5 } }] }, threadId);
    expect(canvas.voice.run(threadId, "canvas_update", { items: [{ id: "map", anchor: "quote", relatedTo: ["quote"] }] })).toContain("Updated map");
    const item = (await call("canvas.get", { threadId })).canvas.items.find((each: { id: string }) => each.id === "quote");
    expect(Object.keys(item)).not.toEqual(expect.arrayContaining(["anchor"]));
    expect(item).not.toHaveProperty("relatedTo");
    expect(item).not.toHaveProperty("point");
    const read = text(await tool("canvas_read", {}, threadId));
    expect(read).not.toMatch(/anchored|related to|note/);
  });

  it("doesn't list or show note items saved before notes were removed", async () => {
    const { call, tool, host } = canvasHost();
    const { threadId } = await call("canvas.create", { text: "Election" });
    await tool("canvas_add", { items: [{ id: "map", kind: "map", data: { PA: 2 } }] }, threadId);
    const db = host.bb.storage.database();
    db.prepare("INSERT INTO canvas_items (canvas_id, id, kind, title, data, options, html, size, importance, created_at, updated_at, rev, rel) SELECT canvas_id, 'why', 'note', 'Why', '\"Flipped\"', '{}', NULL, 's', 2, 1, 1, 1, '{\"anchor\":\"map\"}' FROM canvas_items WHERE id = 'map'").run();
    const view = (await call("canvas.get", { threadId })).canvas;
    expect(view.items.map((each: { id: string }) => each.id)).toEqual(["map"]);
    expect((await call("canvas.list", null)).canvases[0].itemCount).toBe(1);
    const read = text(await tool("canvas_read", {}, threadId));
    expect(read).toContain("1 item(s)");
    expect(read).not.toMatch(/why|note/);
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
