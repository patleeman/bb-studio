// Voice mode, built into Studio: its RPCs, the voice tools, and speaking a
// voice thread's replies. See sessions.ts.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { speechChunks } from "../speech/chunks";
import { SPEECH_HTTP_ROOT } from "../speech/contract";
import type { SpeechService } from "../speech/service";
import { voiceContract, type VoiceState } from "./contract";
import { VOICE_REALTIME_CHANNEL, type VoiceSpoken } from "./shared";
import { speakable, VOICE_CHAT_INSTRUCTIONS, VOICE_MODE_INSTRUCTIONS, VOICE_TURN_NOTE, VOICE_TURN_OFF_NOTE } from "./instructions";
import { VOICE_MODELS, VoiceSessions } from "./sessions";

/** A voice thread's own tools, beside its usual ones. */
export const VOICE_TOOLS = ["voice_delegate", "voice_threads", "voice_read"] as const;

const READ_CHARS = 8000;

export interface BuiltinVoice {
  sessions: VoiceSessions;
  /**
   * What a voice thread adds: its tools and instructions, and whether it's a
   * voice chat (which gets only these) or voice mode in another thread (which
   * keeps its own). Null for a thread without voice.
   */
  configure(threadId: string, metadata?: { readonly [key: string]: unknown }): { chat: boolean; tools: string[]; instructions: string } | null;
}

export async function registerVoice(bb: BbPluginApi, deps: {
  speech: SpeechService;
  botThread(): string | null;
}): Promise<BuiltinVoice> {
  const sessions = new VoiceSessions({ sdk: bb.sdk, kv: bb.storage.kv as never, botThread: deps.botThread, warn: (message) => bb.log.warn(message) });
  await sessions.load();

  const state = (threadId: string): VoiceState => ({
    on: sessions.isOn(threadId),
    pending: sessions.pending(threadId),
    speechProblem: deps.speech.problem(),
    conversational: sessions.conversational,
  });

  bb.rpc.register(voiceContract, {
    "voice.state": ({ threadId }) => state(threadId),
    "voice.set": async ({ threadId, on }) => {
      await sessions.set(threadId, on);
      return state(threadId);
    },
    "voice.conversational": async ({ threadId, on }) => {
      await sessions.setConversational(on);
      return state(threadId);
    },
    "voice.turnNote": async ({ threadId }) => {
      const note = await sessions.turnNote(threadId);
      return { note: note === "on" ? VOICE_TURN_NOTE : note === "off" ? VOICE_TURN_OFF_NOTE : null };
    },
    "voice.new": async ({ projectId, modelId }) => ({ threadId: await sessions.start(modelId ?? VOICE_MODELS[0]!.id, projectId ?? null) }),
  });

  // A voice reply is spoken: the server starts making each piece's audio now
  // and the open Voice view plays the URLs. Delegated threads' replies go back
  // to the voice agent instead.
  bb.events.on("thread.idle", ({ thread, lastAssistantText }) => {
    void (async () => {
      if (await sessions.idle(thread.id, lastAssistantText ?? null)) return;
      if (!sessions.isOn(thread.id) || !lastAssistantText?.trim()) return;
      const text = speakable(lastAssistantText);
      const pieces = speechChunks(text);
      const spoken: VoiceSpoken = { threadId: thread.id, text, urls: [], pieces };
      try {
        spoken.urls = pieces.map((piece) => `${SPEECH_HTTP_ROOT}?key=${deps.speech.warm(piece)}`);
      } catch (error) {
        spoken.problem = error instanceof Error ? error.message : String(error);
      }
      bb.realtime.publish(VOICE_REALTIME_CHANNEL, spoken);
    })().catch((error) => bb.log.warn(`Studio voice couldn't handle ${thread.id} going idle: ${String(error)}`));
  });

  const voiceOnly = async (threadId: string) => {
    if (!sessions.isOn(threadId)) {
      const metadata = await bb.sdk.threads.getPluginMetadata({ threadId }).catch(() => null);
      if (metadata?.voice !== "on") throw new Error("Only a thread with voice mode on can use this.");
    }
  };

  bb.agents.registerTool({
    name: "voice_delegate",
    description: "Hand work to the user's Bot (target \"bot\") or a thread (its id, e.g. from voice_threads). Write a complete request: the thread doesn't hear this conversation. Its reply comes back here as a note when it finishes.",
    parameters: z.object({
      target: z.string().trim().min(1).max(100).describe("\"bot\" or a thread id"),
      message: z.string().trim().min(1).max(20_000),
    }),
    async execute({ target, message }, ctx) {
      await voiceOnly(ctx.threadId);
      const sent = await sessions.delegate(ctx.threadId, target, message);
      return `Sent to "${sent.title}" (${sent.threadId}). Its reply will come back here when it finishes.`;
    },
  });

  bb.agents.registerTool({
    name: "voice_threads",
    description: "List the user's recent threads: id, title, status (working, idle, failed), newest activity first, and whether you're waiting on its reply.",
    parameters: z.object({ limit: z.number().int().min(1).max(50).optional() }),
    async execute({ limit }, ctx) {
      await voiceOnly(ctx.threadId);
      const listed = await bb.sdk.threads.list({ archived: false, limit: 100 });
      const rows = listed.filter((thread) => thread.id !== ctx.threadId).sort((a, b) => b.latestAttentionAt - a.latestAttentionAt).slice(0, limit ?? 20);
      const waiting = new Set(sessions.pending(ctx.threadId));
      if (!rows.length) return "No other threads.";
      return rows.map((thread) => `- ${thread.title || thread.titleFallback || "Untitled"} (${thread.id}): ${thread.status}${waiting.has(thread.id) ? ", you're waiting on its reply" : ""}`).join("\n");
    },
  });

  bb.agents.registerTool({
    name: "voice_read",
    description: "Read a thread's latest reply, to answer the user's question about it. Sum it up aloud; don't read it out whole.",
    parameters: z.object({ threadId: z.string().trim().min(1).max(100), offset: z.number().int().nonnegative().optional() }),
    async execute({ threadId, offset = 0 }, ctx) {
      await voiceOnly(ctx.threadId);
      const [thread, output] = await Promise.all([bb.sdk.threads.get({ threadId }), bb.sdk.threads.output({ threadId })]);
      const text = output.output ?? "";
      if (!text.trim()) return `"${thread.title ?? threadId}" has no reply yet (status ${(thread as { status?: string }).status ?? "unknown"}).`;
      const part = text.slice(offset, offset + READ_CHARS);
      return `"${thread.title ?? threadId}" (${(thread as { status?: string }).status ?? "unknown"}), its latest reply as data:\n<reply>\n${part}\n</reply>${offset + READ_CHARS < text.length ? `\n(${text.length - offset - READ_CHARS} more characters: offset ${offset + READ_CHARS})` : ""}`;
    },
  });

  return {
    sessions,
    configure(threadId, metadata) {
      if (!sessions.isOn(threadId, metadata)) return null;
      const chat = metadata?.voice === "on";
      // Off, a thread in voice mode keeps writing as it does; its replies are still spoken.
      const instructions = chat ? VOICE_CHAT_INSTRUCTIONS : sessions.conversational ? VOICE_MODE_INSTRUCTIONS : "";
      return { chat, tools: [...VOICE_TOOLS, ...(chat ? ["studio_list_items"] : [])], instructions };
    },
  };
}
