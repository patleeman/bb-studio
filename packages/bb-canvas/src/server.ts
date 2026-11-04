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
import { CANVAS_FIRST_NOTE, CANVAS_INSTRUCTIONS, CANVAS_VOICE_NOTE } from "./instructions";
import { CANVAS_CHANNEL, CANVAS_LIMITS, CANVAS_METADATA_KEY, CANVAS_UPDATE_TYPE, type CanvasSignal } from "./shared";
import { CanvasStore, type CanvasActor } from "./store";
import { CANVAS_TOOL_DESCRIPTIONS, CANVAS_TOOL_NAMES, CANVAS_TOOL_PARAMS, canvasVoiceTools, isCanvasTool, runCanvasTool, type CanvasToolName } from "./tools";

export { CANVAS_TOOL_NAMES as CANVAS_TOOLS } from "./tools";

export interface BuiltinCanvas {
  store: CanvasStore;
  /** Whether a thread backs a canvas: its metadata says so, or the store has it. */
  isCanvasThread(threadId: string, metadata?: Readonly<Record<string, unknown>>): boolean;
  instructions: string;
  /** For a hands-free session launched from a canvas thread: Studio's voice calls these over RPC (canvas.voice, canvas.voiceRun). */
  voice: {
    tools(threadId: string | null): ReturnType<typeof canvasVoiceTools>;
    run(threadId: string, name: string, args: Record<string, unknown>): string | null;
  };
}

const PENDING_WAIT_MS = 5000;
/**
 * The model a new canvas thread runs on when the caller names none: Haiku,
 * for speed (a canvas turn should land in seconds). Pinned on the canvas's
 * own thread at creation, never on the user's global default; canvases made
 * before keep the model their thread has.
 */
export const CANVAS_DEFAULT_MODEL = { providerId: "claude-code", model: "claude-haiku-5-5" } as const;
/** BB's personal project: canvas threads live there, as the Bot's do. */
const PERSONAL_PROJECT_ID = "proj_personal";

/** Registers the canvas RPCs, agent tools and thread events. The plugin has run the migrations. */
export function registerCanvas(bb: BbPluginApi, db: Database.Database, options: { now?: () => number } = {}): BuiltinCanvas {
  const store = new CanvasStore(db, options.now);
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

  const run = (canvasId: string, name: CanvasToolName, input: unknown, by: CanvasActor) => {
    const result = runCanvasTool(store, canvasId, name, input, by);
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
        const result = run(row.id, name, input, "agent");
        return result.error ? { content: [{ type: "text" as const, text: result.text }], isError: true } : result.text;
      },
    } as never);
  }

  bb.rpc.register(canvasContract, {
    "canvas.list"() {
      return { canvases: store.list() };
    },
    "canvas.get"({ threadId }) {
      const row = store.byThread(threadId);
      return { canvas: row ? store.view(row.id) : null };
    },
    async "canvas.create"(input) {
      const { text, reasoningLevel } = input;
      // A caller that names a provider or model gets exactly that; otherwise the canvas default.
      const { providerId, model } = input.providerId || input.model ? input : CANVAS_DEFAULT_MODEL;
      const title = text.replace(/\s+/g, " ").trim().slice(0, 80);
      const row = store.create({ title });
      const spawning = bb.sdk.threads.spawn({
        projectId: PERSONAL_PROJECT_ID,
        title: `Canvas: ${title}`,
        environment: { type: "project-default" },
        // The transcript is the canvas's memory; the user sees the board.
        visibility: "hidden",
        pluginMetadata: { [CANVAS_METADATA_KEY]: row.id },
        ...(providerId ? { providerId } : {}),
        ...(model ? { model } : {}),
        ...(reasoningLevel ? { reasoningLevel } : {}),
        ...(providerId || model ? { executionInputSources: { ...(providerId ? { providerId: "explicit" } : {}), ...(model ? { model: "explicit" } : {}), ...(reasoningLevel ? { reasoningLevel: "explicit" } : {}) } } : {}),
        input: [{ type: "text", text, mentions: [] }, { type: "text", text: CANVAS_FIRST_NOTE, mentions: [], visibility: "agent-only" }],
      } as never).then((thread) => {
        store.attach(row.id, (thread as { id: string }).id);
        return (thread as { id: string }).id;
      });
      pending.add(spawning);
      try {
        const threadId = await spawning;
        store.beginTurn(row.id, "user", text);
        store.setStatus(row.id, "working");
        publish(row.id);
        return { canvasId: row.id, threadId };
      } catch (error) {
        store.delete(row.id);
        throw error;
      } finally {
        pending.delete(spawning);
      }
    },
    // Studio's hands-free voice asks these when a session's launching thread is a canvas thread.
    "canvas.voice"({ threadId }) {
      return store.byThread(threadId) ? { tools: canvasVoiceTools(), instructions: CANVAS_VOICE_NOTE } : { tools: [], instructions: null };
    },
    "canvas.voiceRun"({ threadId, name, args }) {
      if (!isCanvasTool(name)) return { output: null };
      const row = store.byThread(threadId);
      if (!row) return { output: "This session isn't speaking for a canvas, so there's no board to edit." };
      return { output: run(row.id, name, args, "voice").text };
    },
    async "canvas.send"({ threadId, text }) {
      const row = store.byThread(threadId);
      if (!row) throw new Error("That canvas is gone.");
      await bb.sdk.threads.send({ threadId, mode: "queue-if-active", input: [{ type: "text", text, mentions: [] }] } as never);
      store.beginTurn(row.id, "user", text);
      store.setStatus(row.id, "working");
      publish(row.id);
      return { ok: true };
    },
  });

  const status = (threadId: string, next: "working" | "idle" | "failed", reply?: string | null) => {
    const row = store.byThread(threadId);
    if (!row) return;
    store.setStatus(row.id, next);
    if (reply?.trim()) {
      store.setCaption(row.id, reply);
      store.note(row.id, "agent", reply.trim().slice(0, CANVAS_LIMITS.messageChars));
    }
    publish(row.id);
  };
  bb.events.on("thread.active", ({ thread }) => status(thread.id, "working"));
  bb.events.on("thread.idle", ({ thread, lastAssistantText }) => status(thread.id, "idle", lastAssistantText));
  bb.events.on("thread.failed", ({ thread }) => status(thread.id, "failed"));

  return {
    store,
    isCanvasThread: (threadId, metadata) => typeof metadata?.[CANVAS_METADATA_KEY] === "string" || !!store.byThread(threadId),
    instructions: CANVAS_INSTRUCTIONS,
    voice: {
      tools: (threadId) => (threadId && store.byThread(threadId) ? canvasVoiceTools() : []),
      run(threadId, name, args) {
        if (!isCanvasTool(name)) return null;
        const row = store.byThread(threadId);
        if (!row) return "This session isn't speaking for a canvas, so there's no board to edit.";
        return run(row.id, name, args, "voice").text;
      },
    },
  };
}
