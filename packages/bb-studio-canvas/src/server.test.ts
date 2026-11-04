import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { CANVAS_MIGRATIONS } from "./migrations";
import { CANVAS_DEFAULT_MODEL, registerCanvas, VOICE_START_NOTE } from "./server";
import { CANVAS_CHANNEL } from "./shared";
import type { ImageDeps, Transport } from "./image";
import { canvasVoiceTools, CANVAS_TOOL_NAMES } from "./tools";

type Sent = { threadId: string; input: { text: string; visibility?: string }[]; mode?: string };

function canvasHost(images?: ImageDeps) {
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
  const canvas = registerCanvas(host.bb, db, { images });
  const call = (method: string, input: unknown) => host.harness.behavior.callRpc(method, input) as Promise<any>;
  const tool = (name: string, input: unknown, threadId: string) => host.harness.behavior.callAgentTool(name, input, { threadId });
  return { host, canvas, spawned, sent, updated, listed, call, tool };
}

const text = (result: unknown): string => typeof result === "string" ? result : JSON.stringify(result);

const PAGE = '<style>.g{display:grid}</style><header data-cv-id="title"><h1>Democrats take the House</h1></header><section data-cv-id="seats"><div data-chart="bignum" data-value="221"></div></section>';

describe("canvas threads", () => {
  it("creates a hidden thread in the personal project with the rules and guide as an agent-only note", async () => {
    const { call, spawned } = canvasHost();
    const { threadId, canvasId } = await call("canvas.create", { text: "How did yesterday's election go?" });
    expect(threadId).toBe("thr_canvas1");
    expect(spawned[0]).toMatchObject({ projectId: "proj_personal", visibility: "hidden", pluginMetadata: { canvas: canvasId } });
    const input = spawned[0]!.input as { text: string; visibility?: string }[];
    expect(input[0]).toMatchObject({ text: "How did yesterday's election go?" });
    expect(input[1]!.visibility).toBe("agent-only");
    for (const words of ["ONE page you design", "DESIGN GUIDE", "Decide the ONE point", "data-chart", "canvas_image", "Never restate or describe the board"]) expect(input[1]!.text).toContain(words);
    const { canvas } = await call("canvas.get", { threadId });
    expect(canvas).toMatchObject({ threadId, status: "working", turn: 1, items: [], page: null });
  });

  it("pins new canvas threads to Sonnet on the canvas's own thread, unless the caller picks a model", async () => {
    const { call, spawned } = canvasHost();
    await call("canvas.create", { text: "Election" });
    expect(spawned[0]).toMatchObject({ providerId: "claude-code", model: "claude-sonnet-5-5", executionInputSources: { providerId: "explicit", model: "explicit" } });
    expect(CANVAS_DEFAULT_MODEL).toEqual({ providerId: "claude-code", model: "claude-sonnet-5-5" });
    await call("canvas.create", { text: "Weather", providerId: "codex", model: "gpt-5.5", reasoningLevel: "low" });
    expect(spawned[1]).toMatchObject({ providerId: "codex", model: "gpt-5.5", reasoningLevel: "low" });
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
  });

  it("starts a canvas by voice with no message, and its [PASS] reply isn't a caption", async () => {
    const { host, call, spawned } = canvasHost();
    const { threadId } = await call("canvas.create", { voice: true });
    expect(JSON.stringify(spawned[0])).toContain(VOICE_START_NOTE);
    expect((await call("canvas.get", { threadId })).canvas).toMatchObject({ title: "Voice canvas", turn: 0, status: "idle" });
    await host.harness.behavior.emitThreadEvent("thread.idle", { thread: { id: threadId } as never, lastAssistantText: "[PASS]" });
    expect((await call("canvas.get", { threadId })).canvas.caption).toBeNull();
    await expect(call("canvas.create", {})).rejects.toThrow();
  });

  it("gives canvas threads their tools and rules in the board's style, and nothing to other threads' check", async () => {
    const { canvas, call } = canvasHost();
    const { threadId, canvasId } = await call("canvas.create", { text: "Hi", look: "field" });
    expect(canvas.isCanvasThread(threadId)).toBe(true);
    expect(canvas.isCanvasThread("thr_other")).toBe(false);
    expect(canvas.isCanvasThread("thr_new", { canvas: canvasId })).toBe(true);
    expect(canvas.instructionsFor(threadId)).toContain("This board is field (Field notes) now.");
    expect(canvas.instructionsFor("thr_new", { canvas: canvasId })).toContain("This board is field");
    expect(canvas.instructionsFor(threadId).length).toBeLessThan(4096);
  });
});

describe("the model picker", () => {
  it("lists BB's available providers and their models, with reasoning levels only when there's a choice", async () => {
    const { call, listed } = canvasHost();
    const { providers } = await call("canvas.models", null);
    expect(providers.map((provider: { id: string }) => provider.id)).toEqual(["claude-code", "codex", "opencode"]);
    const codex = providers.find((provider: { id: string }) => provider.id === "codex");
    expect(codex.models[0]).toEqual({ id: "gpt-6.1-sol", name: "GPT-6.1-Sol", isDefault: true, reasoningLevels: [{ id: "low", label: "low" }, { id: "medium", label: "Medium" }, { id: "high", label: "high" }], defaultReasoningLevel: "medium" });
    expect(providers.find((provider: { id: string }) => provider.id === "opencode")).toMatchObject({ error: "Sign in to OpenCode", models: [] });
    await call("canvas.models", null);
    expect(listed).toHaveLength(3);
  });

  it("records new canvases on Sonnet, and a same-provider pick changes the thread's model in place", async () => {
    const { call, spawned, updated } = canvasHost();
    const { threadId } = await call("canvas.create", { text: "Election" });
    expect((await call("canvas.get", { threadId })).canvas.execution).toEqual({ providerId: "claude-code", model: "claude-sonnet-5-5", reasoningLevel: null });
    const result = await call("canvas.setModel", { threadId, providerId: "claude-code", model: "claude-opus-5-5" });
    expect(result.mode).toBe("same-thread");
    expect(updated).toEqual([{ threadId, model: "claude-opus-5-5", reasoningLevel: null }]);
    expect(spawned).toHaveLength(1);
  });

  it("switches provider with a fresh thread on the next message, keeping the page, and old links still find it", async () => {
    const { call, tool, spawned } = canvasHost();
    const { threadId, canvasId } = await call("canvas.create", { text: "Election" });
    await tool("canvas_page", { html: PAGE }, threadId);
    await call("canvas.setModel", { threadId, providerId: "codex", model: "gpt-6.1-sol", reasoningLevel: "low" });
    expect(await call("canvas.send", { threadId, text: "Drill into the closest races" })).toEqual({ ok: true, threadId: "thr_canvas2" });
    const note = (spawned[1]!.input as { text: string }[])[1]!.text;
    expect(note).toContain("moved to this thread from another model");
    expect(note).toContain("- seats <section>");
    const now = (await call("canvas.get", { threadId: "thr_canvas2" })).canvas;
    expect(now).toMatchObject({ id: canvasId, threadId: "thr_canvas2", page: PAGE });
    expect((await call("canvas.get", { threadId })).canvas.id).toBe(canvasId);
    expect(text(await tool("canvas_read", {}, "thr_canvas2"))).toContain("- title <header> Democrats take the House");
  });

  it("drops a waiting provider switch when the current model is picked again", async () => {
    const { call, spawned } = canvasHost();
    const { threadId } = await call("canvas.create", { text: "Election" });
    await call("canvas.setModel", { threadId, providerId: "codex", model: "gpt-6-luna" });
    const back = await call("canvas.setModel", { threadId, providerId: "claude-code", model: "claude-sonnet-5-5" });
    expect(back).toMatchObject({ mode: "unchanged", canvas: { pendingExecution: null } });
    await call("canvas.send", { threadId, text: "Next" });
    expect(spawned).toHaveLength(1);
  });
});

describe("canvas tools", () => {
  it("shows a page, changes a part by id, reads it back, and publishes each change", async () => {
    const { host, call, tool } = canvasHost();
    const { threadId } = await call("canvas.create", { text: "Election" });
    const before = host.harness.inspection.realtimeSignals.length;
    expect(text(await tool("canvas_page", { html: PAGE, style: "editorial", styleReason: "news" }, threadId))).toContain("The page is up (revision");
    expect(host.harness.inspection.realtimeSignals.slice(before)).toContainEqual(expect.objectContaining({ channel: CANVAS_CHANNEL }));
    let view = (await call("canvas.get", { threadId })).canvas;
    expect(view).toMatchObject({ page: PAGE, title: "Democrats take the House", look: "editorial" });
    expect(text(await tool("canvas_patch", { id: "seats", html: '<section data-cv-id="seats">223</section>' }, threadId))).toContain('Changed part "seats"');
    view = (await call("canvas.get", { threadId })).canvas;
    expect(view.page).toContain('<section data-cv-id="seats">223</section>');
    expect(view.changes.map((change: { op: string }) => change.op)).toEqual(["style", "page", "patch"]);
    const missing = await tool("canvas_patch", { id: "senate", html: "<p>x</p>" }, threadId) as { isError?: boolean; content?: { text: string }[] };
    expect(missing.isError).toBe(true);
    expect(missing.content?.[0]?.text).toContain("Its parts: title, seats");
    const read = text(await tool("canvas_read", {}, threadId));
    expect(read).toContain("Parts (data-cv-id):");
    expect(read).toContain("Page source:");
    expect(read).toContain("Style: editorial (Editorial)");
  });

  it("says when a page has no parts to animate, and refuses an empty or oversized page", async () => {
    const { call, tool } = canvasHost();
    const { threadId } = await call("canvas.create", { text: "Election" });
    expect(text(await tool("canvas_page", { html: "<h1>Hi</h1>" }, threadId))).toContain("No part has a data-cv-id");
    await expect(tool("canvas_page", { html: "" }, threadId)).rejects.toThrow();
    const huge = await tool("canvas_page", { html: "x".repeat(150 * 1024) + "é".repeat(30 * 1024) }, threadId) as { isError?: boolean; content?: { text: string }[] };
    expect(huge.isError).toBe(true);
    expect(huge.content?.[0]?.text).toContain("over 200 KB");
  });

  it("switches the style without rewriting the page, logged with its reason", async () => {
    const { call, tool } = canvasHost();
    const { threadId } = await call("canvas.create", { text: "Plan a trip" });
    await tool("canvas_page", { html: PAGE }, threadId);
    expect(text(await tool("canvas_style", { style: "field", reason: "planning" }, threadId))).toContain("Field notes");
    const view = (await call("canvas.get", { threadId })).canvas;
    expect(view).toMatchObject({ look: "field", page: PAGE });
    expect(view.changes.at(-1).summary).toBe("Style: Field notes (planning)");
    await expect(tool("canvas_style", { style: "classic" }, threadId)).rejects.toThrow(/Invalid option/);
  });

  it("refuses a thread that isn't a canvas, and keeps two canvases apart", async () => {
    const { call, tool } = canvasHost();
    const result = await tool("canvas_page", { html: PAGE }, "thr_somewhere_else") as { isError?: boolean; content?: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("isn't a canvas");
    const a = await call("canvas.create", { text: "A" });
    const b = await call("canvas.create", { text: "B" });
    await tool("canvas_page", { html: PAGE }, a.threadId);
    expect((await call("canvas.get", { threadId: b.threadId })).canvas.page).toBeNull();
  });

  it("still shows an old board of items, and a page replaces it", async () => {
    const { call, tool, canvas } = canvasHost();
    const { threadId, canvasId } = await call("canvas.create", { text: "Election" });
    canvas.store.edit(canvasId, [{ op: "add", item: { id: "house", kind: "stat", data: 220 } }], "agent");
    expect(text(await tool("canvas_read", {}, threadId))).toContain("from before pages");
    expect((await call("canvas.get", { threadId })).canvas.items).toHaveLength(1);
    await tool("canvas_page", { html: PAGE }, threadId);
    expect((await call("canvas.get", { threadId })).canvas).toMatchObject({ items: [], page: PAGE });
  });

  it("returns the design guide from canvas_guide", async () => {
    const { call, tool } = canvasHost();
    const { threadId } = await call("canvas.create", { text: "Ops" });
    const guide = text(await tool("canvas_guide", {}, threadId));
    for (const words of ["Decide the ONE point", "EXAMPLES", "wall of pictures", "Bars and areas start at zero"]) expect(guide).toContain(words);
  });
});

describe("canvas_image", () => {
  const KEY = "exa-test-key-123";
  const publicDns = async () => [{ address: "93.184.216.34" }];
  const htmlPage = (body: string) => ({ status: 200, location: null, type: "text/html", body: (async function* () { yield new TextEncoder().encode(body); })(), close() {} });

  it("takes a page's main picture when no search key is set, and never reaches private addresses", async () => {
    const seen: string[] = [];
    const transport: Transport = async (url) => { seen.push(url.toString()); return htmlPage('<html><head><title>Tetris (Game Boy)</title><meta property="og:image" content="//upload.example.org/tetris.jpg?utm_source=x"><meta property="og:image:width" content="600"></head></html>'); };
    const { call, tool } = canvasHost({ exaKey: async () => "", transport, lookup: publicDns });
    const { threadId } = await call("canvas.create", { text: "Showcase" });
    const found = JSON.parse(text(await tool("canvas_image", { pageUrl: "https://en.wikipedia.org/wiki/Tetris_(Game_Boy_video_game)" }, threadId)));
    expect(found).toEqual({ url: "https://upload.example.org/tetris.jpg", alt: "Tetris (Game Boy)", source: "https://en.wikipedia.org/wiki/Tetris_(Game_Boy_video_game)", width: 600 });
    const noKey = await tool("canvas_image", { query: "Tetris box art" }, threadId) as { isError?: boolean; content?: { text: string }[] };
    expect(noKey.content?.[0]?.text).toContain("No image search key is set. Pass pageUrl");
    const inward = canvasHost({ exaKey: async () => "", transport, lookup: async () => [{ address: "10.0.0.5" }] });
    const inwardThread = (await inward.call("canvas.create", { text: "x" })).threadId;
    const blocked = await inward.tool("canvas_image", { pageUrl: "https://intranet.example.com/" }, inwardThread) as { content?: { text: string }[] };
    expect(blocked.content?.[0]?.text).toContain("isn't a public web page");
    expect(seen).toHaveLength(1);
  });

  it("searches Exa with the key and picks the best match, and never shows the key", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ results: [
        { url: "https://shop.example.com/zelda", title: "Zelda", image: "https://cdn.example.com/logo.png" },
        { url: "https://games.example.com/tetris", title: "Tetris for Game Boy", image: "https://cdn.example.com/tetris-box.jpg", extras: { imageLinks: ["https://cdn.example.com/x.svg"] } },
      ] }), { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    const { call, tool } = canvasHost({ exaKey: async () => KEY, fetch, lookup: publicDns });
    const { threadId } = await call("canvas.create", { text: "Showcase" });
    const found = JSON.parse(text(await tool("canvas_image", { query: "Tetris Game Boy box art" }, threadId)));
    expect(found).toMatchObject({ url: "https://cdn.example.com/tetris-box.jpg", source: "https://games.example.com/tetris" });
    expect(calls[0]!.url).toBe("https://api.exa.ai/search");
    expect((calls[0]!.init.headers as Record<string, string>)["x-api-key"]).toBe(KEY);
    // A failure that echoes the key is redacted.
    const leaky = canvasHost({ exaKey: async () => KEY, fetch: (async () => { throw new Error(`bad key ${KEY}`); }) as unknown as typeof globalThis.fetch, lookup: publicDns });
    const leakyThread = (await leaky.call("canvas.create", { text: "x" })).threadId;
    const failed = text(await leaky.tool("canvas_image", { query: "Tetris" }, leakyThread));
    expect(failed).toContain("bad key [key]");
    expect(failed).not.toContain(KEY);
  });
});

describe("voice", () => {
  it("offers the canvas tools only to a session launched from a canvas thread", async () => {
    const { canvas, call } = canvasHost();
    const { threadId } = await call("canvas.create", { text: "Election" });
    expect(canvas.voice.tools(threadId).map((each) => each.name)).toEqual([...CANVAS_TOOL_NAMES]);
    expect(canvas.voice.tools("thr_other")).toEqual([]);
  });

  it("runs the voice's canvas calls on that canvas, as the voice", async () => {
    const { canvas, call } = canvasHost();
    const { threadId } = await call("canvas.create", { text: "Election" });
    expect(await canvas.voice.run(threadId, "canvas_page", { html: PAGE })).toContain("The page is up");
    expect(await canvas.voice.run(threadId, "canvas_patch", { id: "seats", html: "" })).toContain('Removed part "seats"');
    expect(await canvas.voice.run(threadId, "loops_list", {})).toBeNull();
    expect(await canvas.voice.run("thr_other", "canvas_read", {})).toContain("isn't speaking for a canvas");
    expect((await call("canvas.get", { threadId })).canvas.changes.at(-1)).toMatchObject({ by: "voice", op: "patch", itemId: "seats" });
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
    expect(offered.instructions).toContain("canvas_patch");
    expect(await call("canvas.voice", { threadId: "thr_other" })).toEqual({ tools: [], instructions: null });
    expect((await call("canvas.voiceRun", { threadId, name: "canvas_page", args: { html: PAGE } })).output).toContain("The page is up");
    expect((await call("canvas.voiceRun", { threadId, name: "loops_list", args: {} })).output).toBeNull();
  });
});
