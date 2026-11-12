// Canvas (prototype): the agent talks on a board it edits each turn, backed
// by a hidden BB thread (docs: README).
//
// - The board is in the canvas plugin's database (store.ts), one per canvas thread.
// - The canvas_* tools edit it, scoped to the calling thread: a tool call
//   from any other thread is refused. Each edit publishes at once, so the
//   page animates while the agent (or the hands-free voice) is still talking.
// - The thread's reply becomes the page's caption when it goes idle.
// - A page the agent writes in its reply (one fenced html block) streams: while
//   the thread works, its event log is polled and the growing page published
//   to the page (src/stream.ts); at idle the finished block is the page.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { canvasContract } from "./contract";
import { canvasFirstNote, canvasInstructions, clientNote, CANVAS_VOICE_NOTE } from "./instructions";
import { rendererLoader } from "./renderer";
import { DEFAULT_LOOK, lookOf } from "./looks";
import { fillPictures } from "./page";
import { CANVAS_CHANNEL, CANVAS_DEFAULT_EXECUTION, CANVAS_LIMITS, CANVAS_METADATA_KEY, CANVAS_STREAM_TYPE, CANVAS_UPDATE_TYPE, type CanvasExecution, type CanvasSignal, type CanvasStreamSignal, type PickerProvider } from "./shared";
import { PageStream, STREAM_EVENT_TYPES, turnPage, type EventRow, type TurnPage } from "./stream";
import { CanvasStore, type CanvasActor } from "./store";
import { ImageCache, type ImageDeps } from "./image";
import { normalizeUrl, pageUrlsIn, provenanceOf, webpageInfo, webpageUrl, WebpageCache, type TurnItem } from "./webpage";
import { CANVAS_TOOL_DESCRIPTIONS, CANVAS_TOOL_NAMES, CANVAS_TOOL_PARAMS, canvasVoiceTools, describeBoard, isCanvasTool, runCanvasTool, type CanvasToolName } from "./tools";

export { CANVAS_TOOL_NAMES as CANVAS_TOOLS } from "./tools";

export interface BuiltinCanvas {
  store: CanvasStore;
  /** Whether a thread backs a canvas: its metadata says so, or the store has it. */
  isCanvasThread(threadId: string, metadata?: Readonly<Record<string, unknown>>): boolean;
  /** The same by thread id alone, waiting (up to waitMs) for a canvas thread that is being made right now. */
  isCanvasThreadSoon(threadId: string, waitMs?: number): Promise<boolean>;
  /** The configure hook's instructions for a canvas thread, in its canvas's look (and for its provider: see canvasInstructions). */
  instructionsFor(threadId: string, metadata?: Readonly<Record<string, unknown>>, providerId?: string | null): string;
  /** For a hands-free session launched from a canvas thread: Studio's voice calls these over RPC (canvas.voice, canvas.voiceRun). */
  voice: {
    tools(threadId: string | null): ReturnType<typeof canvasVoiceTools>;
    run(threadId: string, name: string, args: Record<string, unknown>): Promise<string | null>;
  };
}

const PENDING_WAIT_MS = 5000;
const MODELS_TTL_MS = 60_000;

type ProviderEntry = { id: string; displayName?: string; available?: boolean };
type ModelEntry = { id: string; model?: string; displayName?: string; isDefault?: boolean; defaultReasoningEffort?: string; supportedReasoningEfforts?: { reasoningEffort: string; label?: string; description?: string }[] };

/**
 * The picker's providers: BB's available providers, each with the models it
 * lists for the personal project (where canvas threads live), as `bb
 * provider models <id>` shows them. A provider whose models can't be listed
 * (signed out) says why instead.
 */
export async function listProviders(bb: BbPluginApi): Promise<PickerProvider[]> {
  const providers = ((await bb.sdk.providers.list()) as unknown as ProviderEntry[]).filter((provider) => provider.available !== false);
  return Promise.all(providers.map(async (provider): Promise<PickerProvider> => {
    try {
      const result = (await bb.sdk.providers.models({ projectId: PERSONAL_PROJECT_ID, providerId: provider.id })) as unknown as { models: ModelEntry[]; modelLoadError: { code: string; detail: string | null } | null };
      const models = result.models.map((entry) => {
        const levels = (entry.supportedReasoningEfforts ?? []).map((level) => ({ id: level.reasoningEffort, label: level.label || level.reasoningEffort }));
        return {
          id: entry.id,
          name: entry.displayName || entry.id,
          isDefault: !!entry.isDefault,
          // A single level is no choice: the picker shows levels only when there's more than one.
          reasoningLevels: levels.length > 1 ? levels : [],
          defaultReasoningLevel: levels.length > 1 ? entry.defaultReasoningEffort || null : null,
        };
      });
      return { id: provider.id, name: provider.displayName || provider.id, error: result.modelLoadError ? result.modelLoadError.detail || result.modelLoadError.code : null, models };
    } catch (error) {
      return { id: provider.id, name: provider.displayName || provider.id, error: error instanceof Error ? error.message : String(error), models: [] };
    }
  }));
}
/**
 * The model a new canvas thread runs on when the caller names none: Haiku,
 * for speed (a canvas turn should land in seconds). Pinned on the canvas's
 * own thread at creation, never on the user's global default; canvases made
 * before keep the model their thread has.
 */
/** The agent-only note on a canvas started by voice, before the user has said anything. */
export const VOICE_START_NOTE = "The user started this canvas with hands-free voice. The voice session edits this board itself and passes deeper work to you here. Nothing to do yet: reply exactly [PASS].";

export const CANVAS_DEFAULT_MODEL = { providerId: CANVAS_DEFAULT_EXECUTION.providerId, model: CANVAS_DEFAULT_EXECUTION.model } as const;
/** BB's personal project: canvas threads live there, as the Bot's do. */
const PERSONAL_PROJECT_ID = "proj_personal";

/** Registers the canvas RPCs, agent tools and thread events. The plugin has run the migrations. */
export function registerCanvas(bb: BbPluginApi, db: Database.Database, options: { now?: () => number; images?: ImageDeps; streamIntervalMs?: number; webpages?: Pick<ImageDeps, "lookup" | "transport">; rendererDirs?: readonly string[] } = {}): BuiltinCanvas {
  const store = new CanvasStore(db, options.now);
  // The board renderer for the iOS app (canvas.renderer): read once, versioned by its hash.
  const renderer = rendererLoader(options.rendererDirs);
  /** The agent-only line about the user's screen, when the client said it. */
  const clientParts = (client: Parameters<typeof clientNote>[0]) => {
    const line = clientNote(client);
    return line ? [{ type: "text", text: line, mentions: [], visibility: "agent-only" }] : [];
  };
  // Found pictures are reused for a day (memory and this plugin's database).
  const images: ImageDeps | undefined = options.images ? { cache: new ImageCache(db, options.now), ...options.images } : undefined;
  // Webpage parts (src/webpage.ts): looked-up pages are reused for a day.
  const webpages = new WebpageCache(db, options.now);
  /** The current turn's completed items (web fetches and searches among them): the log back to the turn's start. */
  const turnItems = async (threadId: string): Promise<TurnItem[]> => {
    const items: TurnItem[] = [];
    let before: number | null = null;
    // BB pages the log at most 100 events at a time.
    for (let page = 0; page < 10; page++) {
      const rows = await events({ threadId, order: "desc", limit: "100", types: ["turn/started", "item/completed"], ...(before !== null ? { beforeSeq: String(before) } : {}) });
      for (const row of rows) {
        if (row.type === "turn/started") return items;
        const item = row.data?.item as TurnItem | undefined;
        if (item && (item.type === "webFetch" || item.type === "webSearch")) items.push(item);
      }
      if (rows.length < 100) break;
      before = rows.at(-1)!.seq;
    }
    return items;
  };
  /**
   * Where a webpage part's URL came from, once: the user's messages in this chat, or the agent's own fetch or
   * search results in the current turn. A URL verified once stays verified for the canvas. Null: not verified.
   */
  const verifyWebpage = async (canvasId: string, threadId: string, url: string): Promise<string | null> => {
    const key = normalizeUrl(url);
    if (!key) return null;
    const known = store.webpageSource(canvasId, key);
    if (known) return known;
    let items: TurnItem[] = [];
    try { items = await turnItems(threadId); } catch (error) { bb.log.warn(`Visual Chat couldn't read the thread's log to check a link: ${error instanceof Error ? error.message : String(error)}`); }
    const source = provenanceOf(url, store.userTexts(canvasId), items);
    if (source) store.verifyWebpage(canvasId, key, source);
    return source;
  };
  /** A page was committed: its webpage parts are checked now, while their turn's log is the current one. */
  const verifyPageUrls = (canvasId: string) => {
    const row = store.get(canvasId);
    if (!row?.thread_id || !row.page) return;
    const threadId = row.thread_id;
    for (const raw of pageUrlsIn(row.page)) {
      const url = webpageUrl(raw);
      if (url) void verifyWebpage(canvasId, threadId, url).catch(() => {});
    }
  };
  /** Canvases whose thread is being made: a tool call that races the spawn waits for it. */
  const pending = new Set<Promise<unknown>>();

  const publish = (canvasId: string) => {
    const row = store.get(canvasId);
    if (!row?.thread_id) return;
    try { bb.realtime.publish(CANVAS_CHANNEL, { type: CANVAS_UPDATE_TYPE, canvasId, threadId: row.thread_id, rev: row.rev } satisfies CanvasSignal); } catch { /* the page refetches when it opens */ }
  };

  const forThread = async (threadId: string) => {
    let row = store.byThread(threadId);
    if (!row && pending.size) {
      await Promise.race([Promise.allSettled([...pending]), new Promise((resolve) => setTimeout(resolve, PENDING_WAIT_MS))]);
      row = store.byThread(threadId);
    }
    return row;
  };

  const run = async (canvasId: string, name: CanvasToolName, input: unknown, by: CanvasActor) => {
    const result = await runCanvasTool(store, canvasId, name, input, by, images);
    if (name === "canvas_page" || name === "canvas_patch") verifyPageUrls(canvasId);
    if (result.changed) publish(canvasId);
    return result;
  };

  for (const name of CANVAS_TOOL_NAMES) {
    bb.agents.registerTool({
      name,
      description: CANVAS_TOOL_DESCRIPTIONS[name],
      parameters: CANVAS_TOOL_PARAMS[name] as never,
      async execute(input: unknown, ctx: { threadId: string }) {
        const row = await forThread(ctx.threadId);
        if (!row) return { content: [{ type: "text" as const, text: "This thread isn't a canvas, so there's no board to edit. Canvas tools work only in a canvas's own thread." }], isError: true };
        const result = await run(row.id, name, input, "agent");
        return result.error ? { content: [{ type: "text" as const, text: result.text }], isError: true } : result.text;
      },
    } as never);
  }

  /** Starts a canvas's hidden backing thread on this execution; a tool call racing it waits for it. */
  const spawnThread = async (canvasId: string, title: string, run: { providerId: string | null; model: string | null; reasoningLevel: string | null }, input: unknown[]) => {
    const { providerId, model, reasoningLevel } = run;
    const spawning = bb.sdk.threads.spawn({
      projectId: PERSONAL_PROJECT_ID,
      title: `Visual Chat: ${title}`,
      environment: { type: "project-default" },
      // The transcript is the canvas's memory; the user sees the board.
      visibility: "hidden",
      pluginMetadata: { [CANVAS_METADATA_KEY]: canvasId },
      ...(providerId ? { providerId } : {}),
      ...(model ? { model } : {}),
      ...(reasoningLevel ? { reasoningLevel } : {}),
      ...(providerId || model ? { executionInputSources: { ...(providerId ? { providerId: "explicit" } : {}), ...(model ? { model: "explicit" } : {}), ...(reasoningLevel ? { reasoningLevel: "explicit" } : {}) } } : {}),
      input,
    } as never).then((thread) => {
      store.attach(canvasId, (thread as { id: string }).id);
      return (thread as { id: string }).id;
    });
    pending.add(spawning);
    try { return await spawning; } finally { pending.delete(spawning); }
  };

  /** For a fresh thread after a provider switch: what's on the board, and the last few lines of talk. */
  const handoffNote = (canvasId: string) => {
    const talk = store.history(canvasId, 8).map((line) => `- ${line.role === "agent" ? "You" : line.role === "user" ? "User" : line.role}: ${line.text.replace(/\s+/g, " ").slice(0, 300)}`).join("\n");
    return [
      "This canvas moved to this thread from another model; the board stays as it is. Carry on from it: change parts in place by their data-cv-id, keep the style unless the topic changes kind.",
      describeBoard(store, canvasId),
      talk ? `Recent conversation (oldest first):\n${talk}` : "",
    ].filter(Boolean).join("\n\n");
  };

  /** The providers and models BB has, for the picker; listed again after a minute. */
  let listed: { at: number; providers: Promise<PickerProvider[]> } | null = null;
  const models = (): Promise<PickerProvider[]> => {
    const at = (options.now ?? Date.now)();
    if (listed && at - listed.at < MODELS_TTL_MS) return listed.providers;
    const providers = listProviders(bb).catch((error) => { listed = null; throw error; });
    listed = { at, providers };
    return providers;
  };

  /** The version a turn continued from, until that turn's version is saved. */
  const branchedFrom = new Map<string, number>();
  /**
   * The user went back to version n (not the latest) and continues from it: the board returns to that version,
   * and the agent gets a note saying so. Returns the note, or "" when the board is already the latest version.
   */
  const goBack = (canvasId: string, n: number | null | undefined): string => {
    if (!n) return "";
    const versions = store.versions(canvasId);
    const index = versions.findIndex((version) => version.n === n);
    if (index < 0 || index === versions.length - 1) return "";
    store.restoreVersion(canvasId, n, "user");
    branchedFrom.set(canvasId, n);
    publish(canvasId);
    const version = versions[index]!;
    return `The user went back to version ${index + 1} of ${versions.length}${version.prompt ? ` (their message then: "${version.prompt.replace(/\s+/g, " ").slice(0, 200)}")` : ""} and this message continues from it. The board is that version again (canvas_read shows it): build on it, not on the later versions, keeping its ids.`;
  };

  bb.rpc.register(canvasContract, {
    "canvas.list"() {
      return { canvases: store.list() };
    },
    "canvas.get"({ threadId }) {
      const row = store.byThread(threadId);
      return { canvas: row ? store.view(row.id) : null };
    },
    async "canvas.create"(input) {
      // Started by voice: no message yet. The thread gets the rules and answers [PASS]; the voice session edits the board.
      const text = input.text ?? "";
      const look = input.look ?? DEFAULT_LOOK;
      // A caller that names a provider or model gets exactly that; otherwise the canvas default.
      const providerId = input.providerId || input.model ? input.providerId ?? null : CANVAS_DEFAULT_MODEL.providerId;
      const model = input.providerId || input.model ? input.model ?? null : CANVAS_DEFAULT_MODEL.model;
      const reasoningLevel = input.reasoningLevel ?? null;
      const title = text ? text.replace(/\s+/g, " ").trim().slice(0, 80) : "Voice canvas";
      const row = store.create({ title, look, execution: providerId && model ? { providerId, model, reasoningLevel } : null });
      try {
        const first = text
          ? [{ type: "text", text, mentions: [] }]
          : [{ type: "text", text: "🎙 Started by voice.", mentions: [] }, { type: "text", text: VOICE_START_NOTE, mentions: [], visibility: "agent-only" }];
        const threadId = await spawnThread(row.id, title, { providerId, model, reasoningLevel }, [...first, ...clientParts(input.client), { type: "text", text: canvasFirstNote(look, providerId), mentions: [], visibility: "agent-only" }]);
        if (text) {
          store.beginTurn(row.id, "user", text);
          store.setStatus(row.id, "working");
        }
        publish(row.id);
        return { canvasId: row.id, threadId };
      } catch (error) {
        store.delete(row.id);
        throw error;
      }
    },
    // Studio's hands-free voice asks these when a session's launching thread is a canvas thread.
    "canvas.voice"({ threadId }) {
      return store.byThread(threadId) ? { tools: canvasVoiceTools(), instructions: CANVAS_VOICE_NOTE } : { tools: [], instructions: null };
    },
    async "canvas.voiceRun"({ threadId, name, args }) {
      if (!isCanvasTool(name)) return { output: null };
      const row = store.byThread(threadId);
      if (!row) return { output: "This session isn't speaking for a canvas, so there's no board to edit." };
      return { output: (await run(row.id, name, args, "voice")).text };
    },
    async "canvas.webpage"({ threadId, url }) {
      const row = store.byThread(threadId);
      const safe = webpageUrl(url);
      if (!row?.thread_id || !safe) return { status: "invalid" as const, url, source: null, card: null };
      const source = await verifyWebpage(row.id, row.thread_id, safe);
      if (!source) return { status: "unverified" as const, url: safe, source: null, card: null };
      const info = await webpageInfo(safe, webpages, options.webpages ?? {});
      return { status: info.framable ? "frame" as const : "card" as const, url: safe, source, card: info.card };
    },
    "canvas.version"({ threadId, n }) {
      const row = store.byThread(threadId);
      return { version: row ? store.version(row.id, n) : null };
    },
    "canvas.view"({ threadId, n }) {
      const row = store.byThread(threadId);
      if (!row) throw new Error("That canvas is gone.");
      store.setViewing(row.id, n);
      return { viewing: store.viewing(row.id) };
    },
    async "canvas.send"({ threadId, text, fromVersion, client }) {
      const row = store.byThread(threadId);
      if (!row?.thread_id) throw new Error("That canvas is gone.");
      // The board as it was before this turn is a version (a canvas from before versions gets its first now).
      store.ensureFirstVersion(row.id);
      const back = goBack(row.id, fromVersion ?? store.viewing(row.id));
      const next = store.pendingExecution(row.id);
      if (next) {
        // A provider switch: BB can't move a thread to another provider, so the canvas gets a
        // fresh backing thread on it. The board is Canvas's own, so it stays; the new thread
        // gets the rules, the guide, the board as it is and the last few lines of talk.
        const note = `${canvasFirstNote(lookOf(row.look), next.providerId)}\n\n${handoffNote(row.id)}${back ? `\n\n${back}` : ""}`;
        const fresh = await spawnThread(row.id, row.title, next, [{ type: "text", text, mentions: [] }, ...clientParts(client), { type: "text", text: note, mentions: [], visibility: "agent-only" }]);
        store.setExecution(row.id, next);
        store.beginTurn(row.id, "user", text);
        store.setStatus(row.id, "working");
        publish(row.id);
        return { ok: true, threadId: fresh };
      }
      await bb.sdk.threads.send({ threadId: row.thread_id, mode: "queue-if-active", input: [{ type: "text", text, mentions: [] }, ...(back ? [{ type: "text", text: back, mentions: [], visibility: "agent-only" }] : []), ...clientParts(client)] } as never);
      store.beginTurn(row.id, "user", text);
      store.setStatus(row.id, "working");
      publish(row.id);
      return { ok: true, threadId: row.thread_id };
    },
    async "canvas.renderer"(input) {
      const { version, js } = await renderer();
      return { version, js: input?.version === version ? null : js };
    },
    async "canvas.models"() {
      return { providers: await models() };
    },
    async "canvas.setModel"({ threadId, providerId, model, reasoningLevel }) {
      const row = store.byThread(threadId);
      if (!row?.thread_id) throw new Error("That canvas is gone.");
      const pick = { providerId, model, reasoningLevel: reasoningLevel ?? null };
      const current = store.execution(row.id);
      const same = (a: CanvasExecution | null) => !!a && a.providerId === pick.providerId && a.model === pick.model && a.reasoningLevel === pick.reasoningLevel;
      if (same(current)) {
        // The current model again: nothing to change, and any waiting provider switch is dropped.
        if (store.pendingExecution(row.id)) { store.setPendingExecution(row.id, null); publish(row.id); }
        return { mode: "unchanged" as const, canvas: store.view(row.id) };
      }
      if (current && current.providerId === providerId) {
        // Same provider: the thread changes model (and level) for its next turn.
        await bb.sdk.threads.update({ threadId: row.thread_id, model, reasoningLevel: pick.reasoningLevel } as never);
        store.setExecution(row.id, pick);
        publish(row.id);
        return { mode: "same-thread" as const, canvas: store.view(row.id) };
      }
      // Another provider (or a canvas from before the picker): it takes effect with the next message.
      store.setPendingExecution(row.id, pick);
      publish(row.id);
      return { mode: "new-thread-next-turn" as const, canvas: store.view(row.id) };
    },
  });

  /** version: the turn's version saved already (a streamed page, at its fence): idle fills it in instead of adding one. */
  const status = (threadId: string, next: "working" | "idle" | "failed", reply?: string | null, version: number | null = null) => {
    const row = store.byThread(threadId);
    if (!row) return;
    store.setStatus(row.id, next);
    // [PASS] is the thread saying it has nothing to add (a voice start): not a caption.
    if (reply?.trim() && !/^\s*\[PASS\]\s*$/i.test(reply)) {
      store.setCaption(row.id, reply);
      store.note(row.id, "agent", reply.trim().slice(0, CANVAS_LIMITS.messageChars));
    }
    // The finished board is the turn's version (drafts and mid-turn patches never are).
    if (next === "idle" && version !== null) store.refreshVersion(row.id, version);
    else if (next === "idle") { store.saveVersion(row.id, branchedFrom.get(row.id) ?? null); branchedFrom.delete(row.id); }
    publish(row.id);
  };

  // ─── Streaming: a page written in the reply builds on the page as it's written ───
  /** committed: the page committed when its block closed (its source, before pictures) and the version it made. */
  type StreamEntry = { canvasId: string; n: number; stream: PageStream; committed: { source: string; version: number | null } | null };
  const streams = new Map<string, StreamEntry>();
  const publishStream = (signal: CanvasStreamSignal) => {
    try { bb.realtime.publish(CANVAS_CHANNEL, signal); } catch { /* the page catches up at the end of the turn */ }
  };
  const events = (args: Record<string, unknown>) => Promise.resolve().then(() => bb.sdk.threads.events.list(args as never) as unknown as Promise<EventRow[]>);
  /** While a canvas thread works, its reply's page streams to the page. */
  const startStream = (threadId: string) => {
    const row = store.byThread(threadId);
    if (!row || streams.has(threadId)) return;
    let failures = 0;
    const startedAt = Date.now();
    const entry: StreamEntry = { canvasId: row.id, n: 0, stream: null as unknown as PageStream, committed: null };
    entry.stream = new PageStream({
      tip: async () => (await events({ threadId, order: "desc", limit: "1" }))[0]?.seq ?? 0,
      list: async (after, limit) => {
        // A log that can't be read, or a turn that runs on for half an hour, stops the stream (the idle commit still runs).
        if (failures > 20 || Date.now() - startedAt > 30 * 60_000) { entry.stream.halt(); return []; }
        try {
          const rows = await events({ threadId, afterSeq: String(after), order: "asc", limit: String(limit), types: [...STREAM_EVENT_TYPES] });
          failures = 0;
          return rows;
        } catch (error) {
          if (failures++ === 0) bb.log.warn(`Visual Chat can't read the thread's events to stream its page: ${error instanceof Error ? error.message : String(error)}`);
          throw error;
        }
      },
      fill: (html) => fillPictures(html, store.pictures(row.id)).html,
      publish: ({ html, style }) => {
        const now = store.get(row.id);
        if (!now?.thread_id) return;
        // The style named on the fence line applies as the page starts, so it builds in its own style.
        if (style && now.look !== style) { store.edit(row.id, [{ op: "style", look: style, reason: null }], "agent"); publish(row.id); }
        publishStream({ type: CANVAS_STREAM_TYPE, canvasId: row.id, threadId: now.thread_id, n: ++entry.n, html });
      },
      // The block closed: the page is finished, so it's committed now (and is the turn's version), not at turn end.
      onClose: (page) => {
        const before = store.get(row.id)?.rev ?? 0;
        if (!commitPage(row.id, page.html, page.style, page.title)) return;
        store.setCaption(row.id, null); // the caption comes with the end of the turn
        const version = store.saveVersion(row.id, branchedFrom.get(row.id) ?? null);
        branchedFrom.delete(row.id);
        entry.committed = { source: page.html.trim(), version };
        const now = store.get(row.id)!;
        publish(row.id);
        publishStream({ type: CANVAS_STREAM_TYPE, canvasId: row.id, threadId: now.thread_id ?? threadId, n: ++entry.n, done: true, rev: now.rev > before ? now.rev : null });
      },
      onError: () => {},
      ...(options.streamIntervalMs !== undefined ? { intervalMs: options.streamIntervalMs } : {}),
    });
    streams.set(threadId, entry);
    entry.stream.start();
  };
  /** The turn's streamed text (after one last read), and whether its page showed; null without a stream. */
  const stopStream = async (threadId: string) => {
    const entry = streams.get(threadId);
    if (!entry) return null;
    streams.delete(threadId);
    return { entry, text: await entry.stream.stop() };
  };
  /**
   * At the end of a turn: a page in the reply (or, failing that, what streamed of one) becomes the board, as
   * canvas_page would make it. Returns the caption: the words outside the page, else the reply.
   */
  /** A page from the reply becomes the board, as canvas_page would make it (its style, found pictures, title). */
  const commitPage = (canvasId: string, html: string, style: TurnPage["style"], title: string | null): boolean => {
    try {
      if (style && store.get(canvasId)?.look !== style) store.edit(canvasId, [{ op: "style", look: style, reason: null }], "agent");
      store.setPage(canvasId, fillPictures(html.trim(), store.pictures(canvasId)).html, "agent", title);
      verifyPageUrls(canvasId);
      return true;
    } catch (error) {
      bb.log.warn(`Visual Chat couldn't use the page in the reply: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  };
  /**
   * At the end of a turn: a page in the reply (or, failing that, what streamed of one) becomes the board, as
   * canvas_page would make it. Returns the caption: the words outside the page, else the reply.
   */
  const commitReplyPage = (canvasId: string, reply: string | null, streamed: string | null): string | null => {
    const turn = turnPage(reply, streamed);
    if (turn.html) commitPage(canvasId, turn.html, turn.style, turn.title);
    return turn.caption;
  };
  const endTurn = async (threadId: string, next: "idle" | "failed", reply: string | null) => {
    const streamed = await stopStream(threadId);
    const row = store.byThread(threadId);
    if (!row) return;
    const committed = streamed?.entry.committed ?? null;
    const fenced = /(^|\n)[ \t]*(`{3,}|~{3,})[ \t]*html\b/i;
    const hasPage = (reply && fenced.test(reply)) || (streamed && fenced.test(streamed.text));
    const before = store.get(row.id)?.rev ?? 0;
    let caption: string | null;
    if (committed) {
      // The page went up when its block closed; pictures and patches since are on it. The turn's end brings the
      // caption, and a page rewritten after that block (a second block) replaces it.
      const turn = turnPage(next === "idle" ? reply : null, streamed!.text);
      if (turn.complete && turn.html && turn.html !== committed.source) commitPage(row.id, turn.html, turn.style, turn.title);
      caption = turn.caption;
    } else {
      caption = hasPage ? commitReplyPage(row.id, next === "idle" ? reply : null, streamed?.text ?? null) : reply;
    }
    // A new turn started while this one was finishing: it's working again.
    status(threadId, streams.has(threadId) ? "working" : next, next === "idle" ? caption : null, committed?.version ?? null);
    if (streamed && !committed) {
      const rev = store.get(row.id)?.rev ?? 0;
      const now = store.get(row.id);
      publishStream({ type: CANVAS_STREAM_TYPE, canvasId: row.id, threadId: now?.thread_id ?? threadId, n: streamed.entry.n + 1, done: true, rev: rev > before ? rev : null });
    }
  };
  bb.events.on("thread.active", ({ thread }) => { status(thread.id, "working"); startStream(thread.id); });
  bb.events.on("thread.idle", ({ thread, lastAssistantText }) => endTurn(thread.id, "idle", lastAssistantText));
  bb.events.on("thread.failed", ({ thread }) => endTurn(thread.id, "failed", null));

  return {
    store,
    isCanvasThread: (threadId, metadata) => typeof metadata?.[CANVAS_METADATA_KEY] === "string" || !!store.byThread(threadId),
    async isCanvasThreadSoon(threadId, waitMs = PENDING_WAIT_MS) {
      if (store.byThread(threadId)) return true;
      if (!pending.size) return false;
      await Promise.race([Promise.allSettled([...pending]), new Promise((resolve) => setTimeout(resolve, waitMs))]);
      return !!store.byThread(threadId);
    },
    instructionsFor(threadId, metadata, providerId) {
      const id = metadata?.[CANVAS_METADATA_KEY];
      const row = (typeof id === "string" ? store.get(id) : null) ?? store.byThread(threadId);
      return canvasInstructions(lookOf(row?.look), providerId);
    },
    voice: {
      tools: (threadId) => (threadId && store.byThread(threadId) ? canvasVoiceTools() : []),
      async run(threadId, name, args) {
        if (!isCanvasTool(name)) return null;
        const row = store.byThread(threadId);
        if (!row) return "This session isn't speaking for a canvas, so there's no board to edit.";
        return (await run(row.id, name, args, "voice")).text;
      },
    },
  };
}
