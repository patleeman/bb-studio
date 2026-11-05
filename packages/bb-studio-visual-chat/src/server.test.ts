import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { CANVAS_MIGRATIONS } from "./migrations";
import { CANVAS_DEFAULT_MODEL, registerCanvas, VOICE_START_NOTE } from "./server";
import { CANVAS_CHANNEL } from "./shared";
import type { ImageDeps, Transport } from "./image";
import { canvasVoiceTools, CANVAS_TOOL_NAMES } from "./tools";
import type { EventRow } from "./stream";

type Sent = { threadId: string; input: { text: string; visibility?: string }[]; mode?: string };

function canvasHost(images?: ImageDeps, log: EventRow[] = []) {
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
        // The thread's event log, as threads.events.list pages it (streaming reads it).
        events: {
          list: async ({ afterSeq, order, limit, types }: { afterSeq?: string; order?: string; limit?: string; types?: string[] }) => {
            const rows = log.filter((row) => (!afterSeq || row.seq > Number(afterSeq)) && (!types || types.includes(row.type)));
            const sorted = order === "desc" ? [...rows].sort((a, b) => b.seq - a.seq) : rows;
            return sorted.slice(0, Number(limit ?? 100));
          },
        },
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
  const canvas = registerCanvas(host.bb, db, { images, streamIntervalMs: 2 });
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
    for (const words of ["ONE page you design", "DESIGN GUIDE", "Decide the ONE point", "data-chart", "canvas_image", "Never describe the board", "FILL THE SCREEN", "my pick"]) expect(input[1]!.text).toContain(words);
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

  it("tells the agent when it renamed parts that are still on the page, so it can keep their ids", async () => {
    const { call, tool } = canvasHost();
    const { threadId } = await call("canvas.create", { text: "Support" });
    const first = '<h1 data-cv-id="verdict">Fix chat first</h1><section data-cv-id="chat">Chat queue grew to 1,010 a week</section><section data-cv-id="inapp">In-app tickets grew five times since W32</section>';
    await tool("canvas_page", { html: first }, threadId);
    const renamed = '<h1 data-cv-id="title">Fix chat first, then in-app</h1><div data-cv-id="left">Chat queue grew to 1,010 a week</div><div data-cv-id="right">In-app tickets grew five times since W32</div>';
    const result = text(await tool("canvas_page", { html: renamed }, threadId));
    expect(result).toContain("Most parts got new ids");
    expect(result).toContain('"left" → "chat"');
    expect(result).toContain('"right" → "inapp"');
    // Kept ids, or genuinely new content, say nothing.
    expect(text(await tool("canvas_page", { html: renamed }, threadId))).not.toContain("new ids");
    expect(text(await tool("canvas_page", { html: '<h1 data-cv-id="a">Weather</h1><p data-cv-id="b">Sunny all weekend in the city</p><p data-cv-id="c">Rain on Monday morning</p>' }, threadId))).not.toContain("new ids");
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

  it("puts found pictures into the cards by id: on the draft at once, and on every later version", async () => {
    const transport: Transport = async (url) => {
      const search = url.searchParams.get("gsrsearch") ?? "";
      const pages = [{ title: search, index: 1, original: { source: `https://upload.wikimedia.org/${encodeURIComponent(search)}.jpg` } }];
      return { status: 200, location: null, type: "application/json", body: (async function* () { yield new TextEncoder().encode(JSON.stringify({ query: { pages } })); })(), close() {} };
    };
    const { call, tool } = canvasHost({ exaKey: async () => "", transport, lookup: async () => [{ address: "93.184.216.34" }] });
    const { threadId } = await call("canvas.create", { text: "Showcase" });
    const draft = '<div class="cv-wall"><div data-block="card" data-cv-id="g-tetris" data-title="Tetris DX"></div><div data-block="card" data-cv-id="g-own" data-img="https://example.org/mine.jpg"></div><p data-cv-id="g-wario">Wario</p></div>';
    await tool("canvas_page", { html: draft }, threadId);
    const found = text(await tool("canvas_images", { items: [{ key: "g-tetris", query: "Tetris DX" }, { key: "g-own", query: "Own" }, { key: "g-wario", query: "Wario Land 3" }] }, threadId));
    expect(found).toContain("already in: g-tetris");
    let page = (await call("canvas.get", { threadId })).canvas.page as string;
    expect(page).toContain('data-cv-id="g-tetris" data-title="Tetris DX" data-img="https://upload.wikimedia.org/Tetris%20DX.jpg" data-alt="Tetris DX"');
    // A card's own address stays; an element that isn't a card is left alone.
    expect(page).toContain('data-img="https://example.org/mine.jpg"');
    expect(page).not.toContain("Wario%20Land");
    // The full page without data-img gets the pictures back by id.
    const full = text(await tool("canvas_page", { html: '<div data-block="card" data-cv-id="g-tetris" data-title="Tetris DX" data-rating="9"></div>' }, threadId));
    expect(full).toContain("went into 1 card (g-tetris)");
    page = (await call("canvas.get", { threadId })).canvas.page as string;
    expect(page).toContain('data-img="https://upload.wikimedia.org/Tetris%20DX.jpg"');
  });

  it("shows the caption sent with the final page at once", async () => {
    const { call, tool } = canvasHost();
    const { threadId } = await call("canvas.create", { text: "Showcase" });
    const result = text(await tool("canvas_page", { html: PAGE, caption: "Start with Link's Awakening." }, threadId));
    expect(result).toContain("reply with exactly that caption");
    expect((await call("canvas.get", { threadId })).canvas.caption).toBe("Start with Link's Awakening.");
    expect(text(await tool("canvas_page", { html: PAGE }, threadId))).not.toContain("caption");
    expect((await call("canvas.get", { threadId })).canvas.caption).toBe("Start with Link's Awakening.");
  });

  it("returns the design guide from canvas_guide", async () => {
    const { call, tool } = canvasHost();
    const { threadId } = await call("canvas.create", { text: "Ops" });
    const guide = text(await tool("canvas_guide", {}, threadId));
    for (const words of ["Decide the ONE point", "EXAMPLES", "wall of pictures", "Bars and areas start at zero"]) expect(guide).toContain(words);
  });
});

describe("versions", () => {
  const page = (word: string) => `<h1 data-cv-id="title">${word}</h1><p data-cv-id="body">${word} body</p>`;
  const idle = (host: ReturnType<typeof canvasHost>["host"], threadId: string, text: string) => host.harness.behavior.emitThreadEvent("thread.idle", { thread: { id: threadId } as never, lastAssistantText: text });

  it("saves each turn's finished board at turn end, with its prompt and caption, never a draft", async () => {
    const { host, call, tool } = canvasHost();
    const { threadId } = await call("canvas.create", { text: "Show the games" });
    await tool("canvas_page", { html: page("Draft") }, threadId);
    await tool("canvas_page", { html: page("Games"), title: "Games", caption: "Start with Zelda." }, threadId);
    expect((await call("canvas.get", { threadId })).canvas.versions).toEqual([]);
    await idle(host, threadId, "Start with Zelda.");
    // A second idle with nothing new saves nothing.
    await idle(host, threadId, "Start with Zelda.");
    const view = (await call("canvas.get", { threadId })).canvas;
    expect(view.versions).toHaveLength(1);
    expect(view.versions[0]).toMatchObject({ n: 1, title: "Games", prompt: "Show the games", caption: "Start with Zelda.", look: "editorial", items: false, from: null });
    expect((await call("canvas.version", { threadId, n: 1 })).version).toMatchObject({ page: page("Games"), board: [] });
  });

  it("steps through versions, and canvas_read says when the user isn't on the latest", async () => {
    const { host, call, tool } = canvasHost();
    const { threadId } = await call("canvas.create", { text: "One" });
    for (const word of ["One", "Two", "Three"]) {
      if (word !== "One") await call("canvas.send", { threadId, text: word });
      await tool("canvas_page", { html: page(word) }, threadId);
      await idle(host, threadId, `${word} caption.`);
    }
    const versions = (await call("canvas.get", { threadId })).canvas.versions;
    expect(versions.map((version: { prompt: string }) => version.prompt)).toEqual(["One", "Two", "Three"]);
    expect((await call("canvas.version", { threadId, n: 2 })).version.page).toBe(page("Two"));
    expect(text(await tool("canvas_read", {}, threadId))).not.toContain("looking at version");
    expect((await call("canvas.view", { threadId, n: 2 })).viewing).toBe(2);
    expect(text(await tool("canvas_read", {}, threadId))).toContain('looking at version 2 of 3 ("Two"), not the latest');
    // The latest is no "old version".
    expect((await call("canvas.view", { threadId, n: 3 })).viewing).toBeNull();
  });

  it("continues from an old version: the board goes back to it, the agent is told, later versions stay", async () => {
    const { host, call, tool, sent } = canvasHost();
    const { threadId } = await call("canvas.create", { text: "One" });
    await tool("canvas_page", { html: page("One"), style: "field" }, threadId);
    await idle(host, threadId, "One caption.");
    await call("canvas.send", { threadId, text: "Two" });
    await tool("canvas_page", { html: page("Two"), style: "instrument" }, threadId);
    await idle(host, threadId, "Two caption.");
    await call("canvas.send", { threadId, text: "Back to one, but bigger", fromVersion: 1 });
    const now = (await call("canvas.get", { threadId })).canvas;
    expect(now).toMatchObject({ page: page("One"), look: "field", caption: "One caption.", viewing: null });
    const note = sent.at(-1)!.input.find((part: { visibility?: string }) => part.visibility === "agent-only") as { text: string };
    expect(note.text).toContain('went back to version 1 of 2 (their message then: "One")');
    await tool("canvas_page", { html: page("One bigger") }, threadId);
    await idle(host, threadId, "Bigger.");
    const versions = (await call("canvas.get", { threadId })).canvas.versions;
    expect(versions.map((version: { n: number; from: number | null }) => [version.n, version.from])).toEqual([[1, null], [2, null], [3, 1]]);
    // From the latest, nothing goes back and no note is added.
    await call("canvas.send", { threadId, text: "More", fromVersion: 3 });
    expect(sent.at(-1)!.input).toHaveLength(1);
  });

  it("keeps the last 50, and a board from before versions becomes version 1", async () => {
    const { host, call, tool, canvas } = canvasHost();
    const { threadId, canvasId } = await call("canvas.create", { text: "Old board" });
    // A board of items from before versions, idle.
    canvas.store.edit(canvasId, [{ op: "add", item: { id: "house", kind: "stat", data: 220 } }], "agent");
    canvas.store.setStatus(canvasId, "idle");
    await call("canvas.send", { threadId, text: "Now a page" });
    expect((await call("canvas.get", { threadId })).canvas.versions[0]).toMatchObject({ n: 1, items: true, prompt: "Old board" });
    expect((await call("canvas.version", { threadId, n: 1 })).version.board.map((item: { id: string }) => item.id)).toEqual(["house"]);
    await tool("canvas_page", { html: page("First page") }, threadId);
    await idle(host, threadId, "First page.");
    // Going back to the old board of items brings its items back, and the page goes.
    await call("canvas.send", { threadId, text: "Back to the old one", fromVersion: 1 });
    expect((await call("canvas.get", { threadId })).canvas).toMatchObject({ page: null, items: [{ id: "house" }] });
    for (let i = 0; i < 55; i++) {
      await tool("canvas_page", { html: page(`P${i}`) }, threadId);
      await idle(host, threadId, `Caption ${i}.`);
    }
    const versions = (await call("canvas.get", { threadId })).canvas.versions;
    expect(versions).toHaveLength(50);
    expect(versions[0].n).toBe(8);
    expect(versions.at(-1).n).toBe(57);
    await call("canvas.send", { threadId, text: "x", fromVersion: 8 });
    expect((await call("canvas.get", { threadId })).canvas.page).toBe(page("P5"));
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
    const inward = canvasHost({ exaKey: async () => "", transport, lookup: async () => [{ address: "10.0.0.5" }] });
    const inwardThread = (await inward.call("canvas.create", { text: "x" })).threadId;
    const blocked = await inward.tool("canvas_image", { pageUrl: "https://intranet.example.com/" }, inwardThread) as { content?: { text: string }[] };
    expect(blocked.content?.[0]?.text).toContain("isn't a public web page");
    // Wikipedia's API goes through the same check: a resolver answering private is refused before any request.
    const wiki = await inward.tool("canvas_image", { query: "Tetris DX" }, inwardThread) as { content?: { text: string }[] };
    expect(wiki.content?.[0]?.text).toContain("isn't a public web page");
    expect(seen).toHaveLength(1);
  });

  it("finds a picture by name on Wikipedia without a key, and a whole batch in one call", async () => {
    const asked: string[] = [];
    const transport: Transport = async (url) => {
      asked.push(url.toString());
      const search = url.searchParams.get("gsrsearch") ?? "";
      if (url.hostname !== "en.wikipedia.org" || url.pathname !== "/w/api.php") throw new Error("only Wikipedia's API here");
      const pages = search === "Nothing here" ? [] : [{ title: search, index: 1, fullurl: `https://en.wikipedia.org/wiki/${encodeURIComponent(search)}`, original: { source: `https://upload.wikimedia.org/${encodeURIComponent(search)}.jpg`, width: 300, height: 400 } }];
      return { status: 200, location: null, type: "application/json", body: (async function* () { yield new TextEncoder().encode(JSON.stringify({ query: { pages } })); })(), close() {} };
    };
    const { call, tool } = canvasHost({ exaKey: async () => "", transport, lookup: publicDns });
    const { threadId } = await call("canvas.create", { text: "Showcase" });
    const one = JSON.parse(text(await tool("canvas_image", { query: "Tetris DX box art" }, threadId)));
    expect(one).toEqual({ url: "https://upload.wikimedia.org/Tetris%20DX.jpg", alt: "Tetris DX", source: "https://en.wikipedia.org/wiki/Tetris%20DX", width: 300, height: 400 });
    expect(new URL(asked[0]!).searchParams.get("pilicense")).toBe("any");
    const batch = text(await tool("canvas_images", { items: [{ key: "game-wario", query: "Wario Land 3" }, { key: "game-none", query: "Nothing here" }, { key: "game-tetris", query: "Tetris DX box art" }] }, threadId));
    const answers = JSON.parse(batch.slice(0, batch.lastIndexOf("}") + 1));
    expect(Object.keys(answers)).toEqual(["game-wario", "game-none", "game-tetris"]);
    expect(answers["game-wario"].url).toBe("https://upload.wikimedia.org/Wario%20Land%203.jpg");
    expect(answers["game-none"].error).toContain('No picture found for "Nothing here"');
    expect(batch).toContain("1 not found");
    // Tetris DX came from the cache: no second request for it.
    expect(asked.filter((each) => each.includes("Tetris"))).toHaveLength(1);
    await expect(tool("canvas_images", { items: [{ key: "a", query: "x" }, { key: "a", query: "y" }] }, threadId)).rejects.toThrow(/each key once/);
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
    const offline: Transport = async () => { throw new Error("offline"); };
    const leaky = canvasHost({ exaKey: async () => KEY, fetch: (async () => { throw new Error(`bad key ${KEY}`); }) as unknown as typeof globalThis.fetch, lookup: publicDns, transport: offline });
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

describe("a page streamed in the reply", () => {
  const STREAMED = '<style>.w{display:grid}</style><div class="cv-fill"><header data-cv-id="title"><h1>Chromatic: five to own</h1></header><div class="cv-wall w" data-cv-id="games"><div data-block="card" data-cv-id="game-tetris" data-title="Tetris DX" data-rating="9"></div><div data-block="card" data-cv-id="game-links" data-title="Link\'s Awakening DX"></div></div></div>';
  const REPLY = `\`\`\`html style=field\n${STREAMED}\n\`\`\`\nStart with Link's Awakening.`;
  const wait = async (check: () => boolean, what: string) => {
    for (let i = 0; i < 400; i++) { if (check()) return; await new Promise((resolve) => setTimeout(resolve, 2)); }
    throw new Error(`timed out waiting for ${what}`);
  };
  const streamSignals = (host: ReturnType<typeof canvasHost>["host"]) => host.harness.inspection.realtimeSignals
    .map((signal) => (signal as { payload: any }).payload)
    .filter((payload) => payload?.type === "canvas:stream");
  /** The reply as delta rows of one message, in chunks of `size`, from seq `from`. */
  const deltas = (text: string, from: number, size = 40): EventRow[] => {
    const rows: EventRow[] = [];
    for (let i = 0; i < text.length; i += size) rows.push({ seq: from + rows.length, type: "item/agentMessage/delta", data: { delta: text.slice(i, i + size), itemId: "msg1" } });
    return rows;
  };

  async function streamingCanvas() {
    const log: EventRow[] = [{ seq: 1, type: "item/agentMessage/delta", data: { delta: "```html\n<p data-cv-id=\"old\">an earlier turn</p>", itemId: "old" } }];
    const host = canvasHost(undefined, log);
    const { threadId, canvasId } = await host.call("canvas.create", { text: "I just bought a Chromatic, give me a showcase of games including ratings" });
    await host.host.harness.behavior.emitThreadEvent("thread.active", { thread: { id: threadId } as never });
    return { ...host, log, threadId, canvasId };
  }

  it("publishes the page as it grows, from deltas in any order and seen twice, and commits it the moment its block closes", async () => {
    const { host, call, log, threadId } = await streamingCanvas();
    const rows = deltas(REPLY, 10);
    // The first half arrives shuffled, with a duplicate.
    const half = rows.slice(0, Math.ceil(rows.length / 2));
    log.push(...[...half].reverse(), half[0]!);
    await wait(() => streamSignals(host).length > 0, "a stream signal");
    const first = streamSignals(host)[0];
    expect(first).toMatchObject({ threadId, n: 1 });
    expect(first.html).not.toContain("an earlier turn");
    // The style on the fence line applies as the page starts.
    expect((await call("canvas.get", { threadId })).canvas.look).toBe("field");
    log.push(...rows.slice(half.length));
    await wait(() => streamSignals(host).some((signal) => signal.done), "the page committed");
    // Committed while the turn is still working: the page, its title, one version; the caption waits for the turn's end.
    const mid = (await call("canvas.get", { threadId })).canvas;
    expect(mid).toMatchObject({ page: STREAMED, title: "Chromatic: five to own", status: "working", caption: null });
    expect(mid.versions).toHaveLength(1);
    expect(streamSignals(host).at(-1)).toMatchObject({ done: true, rev: mid.rev });
    expect(streamSignals(host).filter((signal) => !signal.done).every((signal) => !signal.html.includes("Start with"))).toBe(true);
    const signals = streamSignals(host).length;
    await host.harness.behavior.emitThreadEvent("thread.idle", { thread: { id: threadId } as never, lastAssistantText: REPLY });
    const view = (await call("canvas.get", { threadId })).canvas;
    expect(view.page).toBe(STREAMED);
    expect(view.caption).toBe("Start with Link's Awakening.");
    expect(view.status).toBe("idle");
    // No second version at idle: the one from the fence gets the caption.
    expect(view.versions).toHaveLength(1);
    expect(view.versions[0]).toMatchObject({ caption: "Start with Link's Awakening.", look: "field", title: "Chromatic: five to own" });
    expect(view.history.at(-1)).toMatchObject({ role: "agent", text: "Start with Link's Awakening." });
    // Nothing more streams after the commit.
    expect(streamSignals(host)).toHaveLength(signals);
  });

  it("fills in the caption and what came after the block at idle, in the same version", async () => {
    const { host, call, tool, log, threadId } = await streamingCanvas();
    // Page first, then a tool call, then the caption alone as the last reply.
    log.push(...deltas(`\`\`\`html\n${STREAMED}\n\`\`\``, 10));
    await wait(() => streamSignals(host).some((signal) => signal.done), "the page committed");
    expect((await call("canvas.get", { threadId })).canvas.versions).toHaveLength(1);
    await tool("canvas_patch", { id: "title", html: '<header data-cv-id="title"><h1>Chromatic: six to own</h1></header>' }, threadId);
    log.push({ seq: 500, type: "item/agentMessage/delta", data: { delta: "Start with Tetris.", itemId: "msg2" } });
    await host.harness.behavior.emitThreadEvent("thread.idle", { thread: { id: threadId } as never, lastAssistantText: "Start with Tetris." });
    const view = (await call("canvas.get", { threadId })).canvas;
    expect(view.caption).toBe("Start with Tetris.");
    expect(view.page).toContain("six to own");
    expect(view.versions).toHaveLength(1);
    expect(view.versions[0]).toMatchObject({ caption: "Start with Tetris.", rev: view.rev });
    expect((await call("canvas.version", { threadId, n: view.versions[0].n })).version.page).toContain("six to own");
    // The next turn makes the next version.
    await call("canvas.send", { threadId, text: "And for two players?" });
    await host.harness.behavior.emitThreadEvent("thread.active", { thread: { id: threadId } as never });
    log.push(...deltas(`\`\`\`html\n<h1 data-cv-id="title">Two players</h1>\n\`\`\`\nLink cable.`, 1000));
    await wait(() => streamSignals(host).filter((signal) => signal.done).length > 1, "the second page committed");
    await host.harness.behavior.emitThreadEvent("thread.idle", { thread: { id: threadId } as never, lastAssistantText: "```html\n<h1 data-cv-id=\"title\">Two players</h1>\n```\nLink cable." });
    const next = (await call("canvas.get", { threadId })).canvas;
    expect(next.versions).toHaveLength(2);
    expect(next.versions[1]).toMatchObject({ caption: "Link cable.", prompt: "And for two players?" });
  });

  it("commits what arrived, repaired, when the turn ends without a closing fence", async () => {
    const { host, call, log, threadId } = await streamingCanvas();
    const cut = REPLY.slice(0, REPLY.indexOf('data-cv-id="game-links"') + 10);
    log.push(...deltas(cut, 10));
    await wait(() => streamSignals(host).length > 0, "a stream signal");
    await host.harness.behavior.emitThreadEvent("thread.idle", { thread: { id: threadId } as never, lastAssistantText: null });
    const view = (await call("canvas.get", { threadId })).canvas;
    expect(view.page).toContain('data-cv-id="game-tetris"');
    expect(view.page).not.toContain("game-links");
    expect(view.page).not.toMatch(/data-cv-(pending|open)/);
    expect(view.page.endsWith("</div></div>")).toBe(true);
    expect(view.versions).toHaveLength(1);
  });

  it("keeps the board when no page came, and the reply is the caption", async () => {
    const { host, call, tool, log, threadId } = await streamingCanvas();
    await tool("canvas_page", { html: PAGE }, threadId);
    log.push(...deltas("Democrats took the House.", 10));
    await host.harness.behavior.emitThreadEvent("thread.idle", { thread: { id: threadId } as never, lastAssistantText: "Democrats took the House." });
    const view = (await call("canvas.get", { threadId })).canvas;
    expect(view.page).toBe(PAGE);
    expect(view.caption).toBe("Democrats took the House.");
    expect(streamSignals(host).filter((signal) => !signal.done)).toEqual([]);
    expect(streamSignals(host).at(-1)).toMatchObject({ done: true, rev: null });
  });

  it("still takes canvas_page and canvas_patch in a streaming turn", async () => {
    const { host, call, tool, threadId } = await streamingCanvas();
    expect(text(await tool("canvas_page", { html: PAGE, caption: "The House flipped." }, threadId))).toContain("The page is up");
    expect(text(await tool("canvas_patch", { id: "seats", html: '<section data-cv-id="seats"><div data-chart="bignum" data-value="222"></div></section>' }, threadId))).toContain("Changed part");
    await host.harness.behavior.emitThreadEvent("thread.idle", { thread: { id: threadId } as never, lastAssistantText: "The House flipped." });
    const view = (await call("canvas.get", { threadId })).canvas;
    expect(view.page).toContain('data-value="222"');
    expect(view.versions).toHaveLength(1);
  });

  it("gives up on a log it can't read, without spinning, and the turn still ends", async () => {
    const broken = { filter: () => { throw new Error("limit must be at most 200"); } } as unknown as EventRow[];
    const { host, call, tool } = canvasHost(undefined, broken);
    const { threadId } = await call("canvas.create", { text: "Election" });
    await host.harness.behavior.emitThreadEvent("thread.active", { thread: { id: threadId } as never });
    await new Promise((resolve) => setTimeout(resolve, 120));
    await tool("canvas_page", { html: PAGE }, threadId);
    await host.harness.behavior.emitThreadEvent("thread.idle", { thread: { id: threadId } as never, lastAssistantText: "The House flipped." });
    const view = (await call("canvas.get", { threadId })).canvas;
    expect(view).toMatchObject({ status: "idle", caption: "The House flipped.", page: PAGE });
  });

  it("commits what streamed when the turn fails", async () => {
    const { host, call, log, threadId } = await streamingCanvas();
    log.push(...deltas(REPLY.slice(0, REPLY.indexOf("</header>") + 9), 10));
    await wait(() => streamSignals(host).length > 0, "a stream signal");
    await host.harness.behavior.emitThreadEvent("thread.failed", { thread: { id: threadId } as never, error: "boom" } as never);
    const view = (await call("canvas.get", { threadId })).canvas;
    expect(view.status).toBe("failed");
    expect(view.page).toContain("Chromatic: five to own");
    expect(view.caption).toBeNull();
  });
});
