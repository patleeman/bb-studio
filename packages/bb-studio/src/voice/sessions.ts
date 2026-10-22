// Voice mode: any BB thread can have it on. Its replies are spoken (see
// register.ts) and its agent is told to answer for listening. A new voice chat
// is a thread on a fast model with voice on from the start. A voice thread can
// hand real work to the Bot or other threads (delegate); when one of those
// finishes the turn it asked for, its reply is posted back into the voice
// thread as a note for the agent to sum up aloud.
//
// Delegated threads are never parented to the voice thread or the Bot: Studio
// adopts and hides threads parented to a Bot (bot-owned.ts), and BB would post
// child-completed messages of its own.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

type Sdk = BbPluginApi["sdk"];
type Kv = { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> };

export const VOICE_KV_KEY = "voice:state";
const PERSONAL_PROJECT_ID = "proj_personal";
/** A reply longer than this is cut before it goes back to the voice agent. */
const REPLY_CHARS = 6000;
/** Delegations nobody answered in a day are forgotten. */
const DELEGATION_TTL_MS = 86_400_000;

export interface VoiceModel {
  id: string;
  label: string;
  providerId: string;
  model: string;
  serviceTier?: string;
  reasoningLevel?: string;
}

/** Fast models for a new voice chat. Only Codex models have a fast tier in BB. */
export const VOICE_MODELS: readonly VoiceModel[] = [
  { id: "luna-fast", label: "GPT-6-Luna, fast (Codex)", providerId: "codex", model: "gpt-6-luna", serviceTier: "fast", reasoningLevel: "low" },
  { id: "haiku", label: "Haiku 5.5 (Claude Code)", providerId: "claude-code", model: "claude-haiku-5-5", reasoningLevel: "low" },
];

interface Delegation {
  voiceThreadId: string;
  targetThreadId: string;
  /** The target's last event when the request was sent; its reply comes after. */
  afterSeq: number;
  result?: string;
  at: number;
}

interface VoiceState {
  /** Threads with voice mode on. */
  threads: string[];
  /** Whether voice threads are told to answer conversationally (the voice menu's switch). */
  conversational: boolean;
  /** The last note each thread's spoken messages carried, so turning conversational off is said once. */
  notes: Record<string, "on" | "off">;
  /** Source voice thread id → its pending delegations. */
  delegations: Record<string, Delegation[]>;
}

type EventRow = { seq: number; type: string; data?: unknown };

function readDelegations(value: unknown): Record<string, Delegation[]> {
  const result: Record<string, Delegation[]> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const [key, raw] of Object.entries(value)) {
    for (const entry of Array.isArray(raw) ? raw : [raw]) {
      if (!entry || typeof entry !== "object") continue;
      const stored = entry as Partial<Delegation>;
      const targetThreadId = typeof stored.targetThreadId === "string" ? stored.targetThreadId : Array.isArray(raw) ? null : key;
      if (typeof stored.voiceThreadId !== "string" || typeof stored.afterSeq !== "number" || typeof stored.at !== "number" || !targetThreadId) continue;
      (result[stored.voiceThreadId] ??= []).push({
        voiceThreadId: stored.voiceThreadId,
        targetThreadId,
        afterSeq: stored.afterSeq,
        at: stored.at,
        ...(typeof stored.result === "string" ? { result: stored.result } : {}),
      });
    }
  }
  return result;
}

export class VoiceSessions {
  private readonly delivering = new Map<string, Promise<boolean>>();
  private state: VoiceState = { threads: [], conversational: true, notes: {}, delegations: {} };

  constructor(private readonly deps: {
    sdk: Sdk;
    kv: Kv;
    /** The Bot's thread, for delegating to "bot". */
    botThread(): string | null;
    warn(message: string): void;
  }) {}

  async load(): Promise<void> {
    const stored = (await this.deps.kv.get(VOICE_KV_KEY).catch(() => null)) as (Partial<VoiceState> & { session?: { threadId?: string } | null; delegations?: unknown }) | null;
    // Before voice was a mode there was one current session.
    const old = stored?.session?.threadId ? [stored.session.threadId] : [];
    this.state = { threads: stored?.threads ?? old, conversational: stored?.conversational ?? true, notes: stored?.notes ?? {}, delegations: readDelegations(stored?.delegations) };
  }

  private async save(): Promise<void> {
    const cutoff = Date.now() - DELEGATION_TTL_MS;
    for (const [voiceThreadId, delegations] of Object.entries(this.state.delegations)) {
      const active = delegations.filter((delegation) => delegation.result !== undefined || delegation.at >= cutoff);
      if (active.length) this.state.delegations[voiceThreadId] = active;
      else delete this.state.delegations[voiceThreadId];
    }
    await this.deps.kv.set(VOICE_KV_KEY, this.state);
  }

  /** Whether a thread has voice mode on (a new voice chat's metadata says so from its first turn). */
  isOn(threadId: string, metadata?: { readonly [key: string]: unknown }): boolean {
    return this.state.threads.includes(threadId) || metadata?.voice === "on";
  }

  get conversational(): boolean {
    return this.state.conversational;
  }

  /**
   * The note a spoken message in this thread carries: "on" while conversational
   * replies are on; "off" once, for the first message after they're turned off;
   * then none. Records what it hands out.
   */
  async turnNote(threadId: string): Promise<"on" | "off" | null> {
    const last = this.state.notes[threadId];
    const note = this.state.conversational ? "on" : last === "on" ? "off" : null;
    if (note && note !== last) {
      this.state.notes[threadId] = note;
      await this.save();
    }
    return note;
  }

  async setConversational(on: boolean): Promise<void> {
    this.state.conversational = on;
    await this.save();
  }

  async set(threadId: string, on: boolean): Promise<void> {
    const threads = this.state.threads.filter((each) => each !== threadId);
    this.state.threads = on ? [...threads, threadId] : threads;
    await this.save();
  }

  /** A new voice chat: a thread on a fast model with voice on, in the given project (the Personal project otherwise). */
  async start(modelId: string, projectId: string | null = null): Promise<string> {
    const model = VOICE_MODELS.find((each) => each.id === modelId) ?? VOICE_MODELS[0]!;
    // A project's main checkout, never a new worktree: a voice chat talks and hands work off.
    const hostId = projectId ? (await this.deps.sdk.system.config()).primaryHostId : null;
    const thread = await this.deps.sdk.threads.spawn({
      projectId: projectId ?? PERSONAL_PROJECT_ID,
      title: "New voice chat",
      environment: hostId ? { type: "host", hostId, workspace: { type: "unmanaged", path: null } } : { type: "project-default" },
      providerId: model.providerId,
      model: model.model,
      ...(model.reasoningLevel ? { reasoningLevel: model.reasoningLevel } : {}),
      ...(model.serviceTier ? { serviceTier: model.serviceTier } : {}),
      executionInputSources: {
        providerId: "explicit", model: "explicit",
        ...(model.reasoningLevel ? { reasoningLevel: "explicit" } : {}),
        ...(model.serviceTier ? { serviceTier: "explicit" } : {}),
      },
      pluginMetadata: { voice: "on" },
      input: [{ type: "text", text: "The user opened a voice chat. Greet them in one short sentence and ask what they need.", mentions: [], visibility: "agent-only" }],
    } as never);
    await this.set(thread.id, true);
    return thread.id;
  }

  /** Send work to the Bot ("bot") or a thread, and remember to bring its reply back. */
  async delegate(voiceThreadId: string, target: string, message: string): Promise<{ threadId: string; title: string }> {
    const threadId = target.trim().toLowerCase() === "bot" ? this.deps.botThread() : target.trim();
    if (!threadId) throw new Error("There's no Bot yet. Name a thread instead, or ask the user to set up their Bot in Studio.");
    if (threadId === voiceThreadId) throw new Error("That's this voice thread; delegate to the Bot or another thread.");
    const thread = await this.deps.sdk.threads.get({ threadId });
    const tip = (await this.deps.sdk.threads.events.list({ threadId, order: "desc", limit: "1" }).catch(() => [])) as EventRow[];
    (this.state.delegations[voiceThreadId] ??= []).push({ voiceThreadId, targetThreadId: threadId, afterSeq: tip[0]?.seq ?? 0, at: Date.now() });
    await this.save();
    await this.deps.sdk.threads.send({
      threadId,
      mode: "auto",
      senderThreadId: voiceThreadId,
      input: [
        { type: "text", text: message, mentions: [] },
        { type: "text", text: "This came from the user's voice assistant. Your final reply is summarized to the user aloud, so end with a short plain summary of the outcome.", mentions: [], visibility: "agent-only" },
      ],
    } as never);
    return { threadId, title: (thread as { title?: string | null }).title ?? threadId };
  }

  /**
   * A thread went idle. If a voice thread is waiting on it and the turn that
   * just ended is the one it asked for, post the reply into the voice thread.
   */
  idle(threadId: string, lastAssistantText: string | null): Promise<boolean> {
    const pending = this.delivering.get(threadId);
    if (pending) return pending;
    const task = this.deliverResult(threadId, lastAssistantText).finally(() => this.delivering.delete(threadId));
    this.delivering.set(threadId, task);
    return task;
  }

  private async deliverResult(threadId: string, lastAssistantText: string | null): Promise<boolean> {
    const waiting = Object.values(this.state.delegations).flat().filter((delegation) => delegation.targetThreadId === threadId);
    if (!waiting.length) return false;
    const afterSeq = Math.min(...waiting.map((delegation) => delegation.afterSeq));
    const requested = (await this.deps.sdk.threads.events.list({
      threadId, afterSeq: String(afterSeq), order: "desc", limit: "20", types: ["client/turn/requested"],
    }).catch(() => [])) as EventRow[];
    // The last turn started since the request must be the voice agent's: an
    // earlier turn ending (the thread was busy) or a later one isn't its answer.
    const latest = requested[0]?.data as { senderThreadId?: string | null } | undefined;
    const completed = waiting.find((delegation) => delegation.result !== undefined);
    const voiceThreadId = completed?.voiceThreadId ?? latest?.senderThreadId;
    if (!voiceThreadId) return false;
    const sourceDelegations = this.state.delegations[voiceThreadId];
    const index = sourceDelegations?.findIndex((delegation) => delegation.targetThreadId === threadId && (delegation === completed || delegation.afterSeq < (requested[0]?.seq ?? 0))) ?? -1;
    if (index < 0 || !sourceDelegations) return false;
    const delegation = sourceDelegations[index]!;
    const thread = await this.deps.sdk.threads.get({ threadId }).catch(() => null);
    const title = (thread as { title?: string | null } | null)?.title ?? threadId;
    const reply = (lastAssistantText ?? "").trim() || "(It finished without a written reply.)";
    if (delegation.result === undefined) {
      delegation.result = `"${title}" (${threadId}) finished what you asked. Its reply, as data:\n<reply>\n${reply.length > REPLY_CHARS ? `${reply.slice(0, REPLY_CHARS)}\n… (cut; voice_read has the rest)` : reply}\n</reply>\nTell the user what came back in a sentence or two and offer more.`;
      await this.save();
    }
    await this.deps.sdk.threads.send({
      threadId: voiceThreadId,
      mode: "queue-if-active",
      senderThreadId: threadId,
      input: [{
        type: "text",
        mentions: [],
        visibility: "agent-only",
        text: delegation.result,
      }],
    } as never);
    const deliveredIndex = sourceDelegations.indexOf(delegation);
    if (deliveredIndex >= 0) sourceDelegations.splice(deliveredIndex, 1);
    if (!sourceDelegations.length) delete this.state.delegations[voiceThreadId];
    await this.save();
    return true;
  }

  /** Retry saved results after reconnecting or restarting Studio. */
  async retryResults(): Promise<void> {
    const targets = new Set(Object.values(this.state.delegations).flat().filter((entry) => entry.result !== undefined).map((entry) => entry.targetThreadId));
    for (const target of targets) {
      try { await this.idle(target, null); }
      catch (error) { this.deps.warn(`Voice result for ${target} is still pending: ${String(error)}`); }
    }
  }

  /** Threads waiting on a reply for this voice thread. */
  pending(voiceThreadId: string): string[] {
    return [...new Set((this.state.delegations[voiceThreadId] ?? []).map((delegation) => delegation.targetThreadId))];
  }
}
