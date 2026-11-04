// Canvas (prototype): the agent talks on a board it edits each turn, backed
// by a hidden BB thread (docs: README).
//
// - The board is in the canvas plugin's database (store.ts), one per canvas thread.
// - The canvas_* tools edit it, scoped to the calling thread: a tool call
//   from any other thread is refused. Each edit publishes at once, so the
//   page animates while the agent (or the hands-free voice) is still talking.
// - The thread's reply becomes the page's caption when it goes idle.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type Database from "better-sqlite3";
import { canvasContract } from "./contract";
import { canvasFirstNote, canvasInstructions, CANVAS_VOICE_NOTE } from "./instructions";
import { DEFAULT_LOOK, lookOf } from "./looks";
import { CANVAS_CHANNEL, CANVAS_DEFAULT_EXECUTION, CANVAS_LIMITS, CANVAS_METADATA_KEY, CANVAS_UPDATE_TYPE, type CanvasExecution, type CanvasSignal, type PickerProvider } from "./shared";
import { CanvasStore, type CanvasActor } from "./store";
import { ImageCache, type ImageDeps } from "./image";
import { CANVAS_TOOL_DESCRIPTIONS, CANVAS_TOOL_NAMES, CANVAS_TOOL_PARAMS, canvasVoiceTools, describeBoard, isCanvasTool, runCanvasTool, type CanvasToolName } from "./tools";

export { CANVAS_TOOL_NAMES as CANVAS_TOOLS } from "./tools";

export interface BuiltinCanvas {
  store: CanvasStore;
  /** Whether a thread backs a canvas: its metadata says so, or the store has it. */
  isCanvasThread(threadId: string, metadata?: Readonly<Record<string, unknown>>): boolean;
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
export function registerCanvas(bb: BbPluginApi, db: Database.Database, options: { now?: () => number; images?: ImageDeps } = {}): BuiltinCanvas {
  const store = new CanvasStore(db, options.now);
  // Found pictures are reused for a day (memory and this plugin's database).
  const images: ImageDeps | undefined = options.images ? { cache: new ImageCache(db, options.now), ...options.images } : undefined;
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
        const threadId = await spawnThread(row.id, title, { providerId, model, reasoningLevel }, [...first, { type: "text", text: canvasFirstNote(look, providerId), mentions: [], visibility: "agent-only" }]);
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
    async "canvas.send"({ threadId, text, fromVersion }) {
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
        const fresh = await spawnThread(row.id, row.title, next, [{ type: "text", text, mentions: [] }, { type: "text", text: note, mentions: [], visibility: "agent-only" }]);
        store.setExecution(row.id, next);
        store.beginTurn(row.id, "user", text);
        store.setStatus(row.id, "working");
        publish(row.id);
        return { ok: true, threadId: fresh };
      }
      await bb.sdk.threads.send({ threadId: row.thread_id, mode: "queue-if-active", input: [{ type: "text", text, mentions: [] }, ...(back ? [{ type: "text", text: back, mentions: [], visibility: "agent-only" }] : [])] } as never);
      store.beginTurn(row.id, "user", text);
      store.setStatus(row.id, "working");
      publish(row.id);
      return { ok: true, threadId: row.thread_id };
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

  const status = (threadId: string, next: "working" | "idle" | "failed", reply?: string | null) => {
    const row = store.byThread(threadId);
    if (!row) return;
    store.setStatus(row.id, next);
    // [PASS] is the thread saying it has nothing to add (a voice start): not a caption.
    if (reply?.trim() && !/^\s*\[PASS\]\s*$/i.test(reply)) {
      store.setCaption(row.id, reply);
      store.note(row.id, "agent", reply.trim().slice(0, CANVAS_LIMITS.messageChars));
    }
    // The finished board is the turn's version (drafts and mid-turn patches never are).
    if (next === "idle") { store.saveVersion(row.id, branchedFrom.get(row.id) ?? null); branchedFrom.delete(row.id); }
    publish(row.id);
  };
  bb.events.on("thread.active", ({ thread }) => status(thread.id, "working"));
  bb.events.on("thread.idle", ({ thread, lastAssistantText }) => status(thread.id, "idle", lastAssistantText));
  bb.events.on("thread.failed", ({ thread }) => status(thread.id, "failed"));

  return {
    store,
    isCanvasThread: (threadId, metadata) => typeof metadata?.[CANVAS_METADATA_KEY] === "string" || !!store.byThread(threadId),
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
