// Voice calls with the Bot over OpenAI's Realtime API.
//
// - Start: the server checks the month's spend against the cap and mints a
//   client secret with the whole session (model, voice, instructions, server
//   VAD, input transcription, tools; session.ts). The key stays here.
// - On the call: the client talks WebRTC to OpenAI. The model's tool calls
//   come back through voice_call_tool; every tool but send_to_bot only reads.
//   send_to_bot posts a visible message in the Bot's chat, marked as from the
//   call. When the Bot finishes that turn its reply is kept for the call, which
//   picks it up (voice_call_poll) and has the voice say it.
// - The client reports finished transcript lines and each response's usage;
//   the cost is estimated from those against the price table (bot-prices.ts).
// - Hang-up: the record (transcript, what it sent, minutes, cost) goes on a
//   page, linked from a line in the Bot's chat. A Bot reply after hang-up
//   stays in the chat and goes to the phone (Studio Mobile).
//
// voice_calls and voice_call_events are append-only: a call's state (ended,
// replies picked up) is the events it has.
import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { addRealtimeUsage, addTranscriptionUsage, EMPTY_TALLY, realtimeCost, realtimePriceFor, type RealtimeTally } from "../../bot-prices";
import { speakable } from "../instructions";
import type { CallEvent, VoiceCallState, VoiceCallView } from "./contract";
import { CALL_MODELS, CALL_TRANSCRIBE_MODEL, CALL_VOICES, CLIENT_SECRETS_URL, clientSecretRequest } from "./session";
import { botReplyNote, callLength, callUsd, REALTIME_CALLS_URL, VOICE_CALL_TOOLS, type VoiceCallSignal, type VoiceCallToolName } from "./shared";

export const DEFAULT_CALL_CAP_USD = 20;
/** Most a tool answers with, in characters. */
export const TOOL_OUTPUT_CHARS = 4000;
/** Most send_to_bot sends. */
export const SEND_CHARS = 4000;
/** A Bot reply is cut to this before the voice says it. */
export const REPLY_SUMMARY_CHARS = 600;
/** Calls this old no longer wait for the Bot's reply. */
const WAIT_MS = 24 * 3600_000;

export const VOICE_CALL_SETTINGS = {
  voiceCallMonthlyCapUsd: { type: "number" as const, label: "Voice calls: monthly cap (USD)", description: "Studio refuses to start a voice call with the Bot once this calendar month's calls reach it, estimated from OpenAI's usage reports.", default: DEFAULT_CALL_CAP_USD },
  voiceCallModel: { type: "select" as const, label: "Voice calls: model", description: "OpenAI's Realtime model for voice calls with the Bot. Mini costs about a third as much.", options: [...CALL_MODELS] as string[], default: CALL_MODELS[0] as string },
  voiceCallVoice: { type: "select" as const, label: "Voice calls: voice", description: "The voice the call speaks in. OpenAI recommends marin or cedar.", options: [...CALL_VOICES] as string[], default: CALL_VOICES[0] as string },
};

export interface CallBot { id: string; name: string; threadId: string | null; state: string }

export interface VoiceCallDeps {
  db: Database.Database;
  fetch?: typeof fetch;
  /** Studio's OpenAI key (src/openai-key.ts); "" when there's none. Never logged or returned. */
  key(): string;
  /** The call settings' current values. */
  settings(): Record<string, unknown>;
  /** A Bot (the primary without an id), or null. */
  bot(botId?: string): CallBot | null;
  /** The Bot whose chat (or handoff chain) a thread is. */
  botForThread(threadId: string): CallBot | null;
  /** The read-only tools' answers. */
  read: { botStatus(bot: CallBot): Promise<string>; leadsStatus(bot: CallBot): Promise<string>; dailyBrief(): Promise<string> };
  /** Posts to a Bot's chat: a visible line and an agent-only note. */
  send(input: { threadId: string; text: string; note: string; mode: "auto" | "queue-if-active" }): Promise<void>;
  /** A phone push (Studio Mobile's notify) whose Reply goes to the Bot's chat. */
  push(input: { title: string; body: string; threadId: string; coalesceKey: string }): Promise<void>;
  /** Saves the call's record as a page; its id, or null when it couldn't. */
  savePage(input: { title: string; markdown: string }): string | null;
  /** The page's link in the chat. */
  pageHref(pageId: string): string;
  publish(signal: VoiceCallSignal): void;
  now?(): number;
  warn?(message: string): void;
}

type CallRow = { id: string; bot_id: string; bot_name: string; thread_id: string | null; model: string; voice: string; transcribe_model: string | null; started_at: number };
type EventRow = { id: number; call_id: string; at: number; kind: string; role: string | null; text: string | null; data: string | null };


/** The start of the calendar month `at` is in, on this machine's clock. */
export function monthStart(at: number): number {
  const date = new Date(at);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

/** A Bot reply cut down for the voice to say. */
export function replySummary(text: string): string {
  return clip(speakable(text).replace(/\s+/g, " ").trim(), REPLY_SUMMARY_CHARS);
}

/** Whether a Bot's reply is a real answer (not [PASS] or empty). */
const answered = (text: string | null | undefined) => !!text?.trim() && !/^\s*\[PASS\]\s*$/i.test(text);

export class CallRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CallRefused";
  }
}

export class VoiceCalls {
  constructor(private readonly deps: VoiceCallDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private config() {
    const values = this.deps.settings();
    const cap = Number(values.voiceCallMonthlyCapUsd);
    const model = String(values.voiceCallModel ?? "");
    const voice = String(values.voiceCallVoice ?? "");
    return {
      capUsd: Number.isFinite(cap) && cap >= 0 ? cap : DEFAULT_CALL_CAP_USD,
      model: (CALL_MODELS as readonly string[]).includes(model) ? model : CALL_MODELS[0],
      voice: (CALL_VOICES as readonly string[]).includes(voice) ? voice : CALL_VOICES[0],
    };
  }

  private call(callId: string): CallRow {
    const row = this.deps.db.prepare("SELECT * FROM voice_calls WHERE id = ?").get(callId) as CallRow | undefined;
    if (!row) throw new Error("There's no such call.");
    return row;
  }

  private events(callId: string): EventRow[] {
    return this.deps.db.prepare("SELECT * FROM voice_call_events WHERE call_id = ? ORDER BY id").all(callId) as EventRow[];
  }

  private append(callId: string, kind: string, fields: { role?: string; text?: string; data?: unknown; at?: number } = {}): number {
    return Number(this.deps.db.prepare("INSERT INTO voice_call_events (call_id, at, kind, role, text, data) VALUES (?, ?, ?, ?, ?, ?)")
      .run(callId, fields.at ?? this.now(), kind, fields.role ?? null, fields.text ?? null, fields.data === undefined ? null : JSON.stringify(fields.data)).lastInsertRowid);
  }

  private ended(events: readonly EventRow[]): EventRow | undefined {
    return events.find((event) => event.kind === "ended");
  }

  private tally(events: readonly EventRow[]): RealtimeTally {
    let tally = EMPTY_TALLY;
    for (const event of events) {
      if (event.kind !== "usage" && event.kind !== "transcription_usage") continue;
      let usage: unknown;
      try { usage = JSON.parse(event.data ?? "null"); } catch { continue; }
      tally = event.kind === "usage" ? addRealtimeUsage(tally, (usage ?? {}) as never) : addTranscriptionUsage(tally, usage as never);
    }
    return tally;
  }

  private cost(row: CallRow, events = this.events(row.id)): number | null {
    return realtimeCost(row.model, this.tally(events), row.transcribe_model);
  }

  /** This calendar month's calls, estimated. */
  monthUsd(): number {
    const rows = this.deps.db.prepare("SELECT * FROM voice_calls WHERE started_at >= ?").all(monthStart(this.now())) as CallRow[];
    return rows.reduce((sum, row) => sum + (this.cost(row) ?? 0), 0);
  }

  /** Why a call can't start now, or null. */
  private problem(): string | null {
    if (!this.deps.key()) return "Voice calls need an OpenAI API key: add one in Studio's settings (OpenAI API key), or set OPENAI_API_KEY on the BB host.";
    const { capUsd } = this.config();
    const spent = this.monthUsd();
    if (spent >= capUsd) {
      const next = new Date(monthStart(this.now()));
      next.setMonth(next.getMonth() + 1);
      return `This month's voice calls have reached the ${callUsd(capUsd)} cap (about ${callUsd(spent)} so far). Raise "Voice calls: monthly cap" in Studio's settings, or call again from ${next.toLocaleDateString("en-US", { month: "long", day: "numeric" })}.`;
    }
    return null;
  }

  state(input: { threadId?: string; botId?: string }): VoiceCallState {
    const bot = input.threadId ? this.deps.botForThread(input.threadId) : this.deps.bot(input.botId);
    const { capUsd, model } = this.config();
    const problem = bot ? (bot.threadId ? this.problem() : `${bot.name} has no chat yet.`) : null;
    return { botId: bot?.id ?? null, botName: bot?.name ?? null, ready: !!bot && !problem, problem, monthUsd: this.monthUsd(), capUsd, model };
  }

  /** Checks the cap and mints the call's client secret. */
  async start(botId?: string) {
    const bot = this.deps.bot(botId);
    if (!bot) throw new CallRefused("Make your Bot first: Studio → Bot.");
    if (!bot.threadId) throw new CallRefused(`${bot.name} has no chat yet.`);
    const problem = this.problem();
    if (problem) throw new CallRefused(problem);
    const { model, voice } = this.config();
    const response = await (this.deps.fetch ?? fetch)(CLIENT_SECRETS_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${this.deps.key()}`, "content-type": "application/json" },
      body: JSON.stringify(clientSecretRequest({ botName: bot.name, model, voice })),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await response.text();
    if (!response.ok) {
      let message = body.slice(0, 300);
      try { message = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? message; } catch { /* Plain text. */ }
      throw new Error(`OpenAI couldn't start the call (${response.status}): ${message}`);
    }
    const minted = JSON.parse(body) as { value?: unknown; expires_at?: unknown };
    if (typeof minted.value !== "string" || !minted.value) throw new Error("OpenAI answered without a client secret.");
    const callId = `vc_${randomBytes(8).toString("hex")}`;
    this.deps.db.prepare("INSERT INTO voice_calls (id, bot_id, bot_name, thread_id, model, voice, transcribe_model, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(callId, bot.id, bot.name, bot.threadId, model, voice, CALL_TRANSCRIBE_MODEL, this.now());
    const expiresAt = typeof minted.expires_at === "number" ? minted.expires_at * 1000 : this.now() + 60_000;
    return { callId, clientSecret: minted.value, expiresAt, model, voice, callsUrl: REALTIME_CALLS_URL, botName: bot.name };
  }

  private live(callId: string): { row: CallRow; events: EventRow[] } {
    const row = this.call(callId);
    const events = this.events(callId);
    if (this.ended(events)) throw new Error("That call has ended.");
    return { row, events };
  }

  /** Runs one of the model's tool calls. Only send_to_bot writes. */
  async tool(callId: string, name: string, args: string | undefined): Promise<string> {
    const { row } = this.live(callId);
    if (!(VOICE_CALL_TOOLS as readonly string[]).includes(name)) return `There's no tool named ${JSON.stringify(clip(name, 64))}. Use ${VOICE_CALL_TOOLS.join(", ")}.`;
    let parsed: Record<string, unknown> = {};
    if (args?.trim()) {
      try {
        const value = JSON.parse(args) as unknown;
        if (!value || typeof value !== "object" || Array.isArray(value)) return "The arguments must be a JSON object.";
        parsed = value as Record<string, unknown>;
      } catch { return "The arguments weren't valid JSON."; }
    }
    const bot = this.deps.bot(row.bot_id) ?? { id: row.bot_id, name: row.bot_name, threadId: row.thread_id, state: "unknown" };
    try {
      return clip(await this.run(row, bot, name as VoiceCallToolName, parsed), TOOL_OUTPUT_CHARS);
    } catch (error) {
      return `That didn't work: ${clip(error instanceof Error ? error.message : String(error), 300)}`;
    }
  }

  private async run(row: CallRow, bot: CallBot, name: VoiceCallToolName, args: Record<string, unknown>): Promise<string> {
    switch (name) {
      case "bot_status": return this.deps.read.botStatus(bot);
      case "leads_status": return this.deps.read.leadsStatus(bot);
      case "daily_brief": return this.deps.read.dailyBrief();
      case "send_to_bot": {
        const message = typeof args.message === "string" ? args.message.trim() : "";
        if (!message) return "send_to_bot needs a message.";
        if (message.length > SEND_CHARS) return `That message is ${message.length} characters; the most is ${SEND_CHARS}. Shorten it.`;
        const threadId = bot.threadId ?? row.thread_id;
        if (!threadId) return `${bot.name} has no chat to send to.`;
        await this.deps.send({
          threadId, mode: "auto",
          text: `📞 From the call: ${message}`,
          note: `The user asked for this on a voice call with you; Studio's call voice sent it. Your final reply is summed up to them aloud on the call, so end with a short plain summary of the outcome. Don't spend money, send anything outward-facing or delete anything on the call's word: ask the user here in the chat first.`,
        });
        this.append(row.id, "sent", { text: message });
        return "sent";
      }
    }
  }

  /** Saves what the client saw. */
  record(callId: string, events: readonly CallEvent[]): { costUsd: number | null; replies: number } {
    const { row } = this.live(callId);
    this.save(row.id, events);
    return { costUsd: this.cost(row), replies: this.waitingReplies(this.events(row.id)).length };
  }

  private save(callId: string, events: readonly CallEvent[]) {
    const insert = this.deps.db.transaction(() => {
      for (const event of events) {
        if (event.type === "transcript") {
          if (event.text.trim()) this.append(callId, "transcript", { role: event.role, text: event.text.trim(), at: event.at });
        } else this.append(callId, event.type, { data: event.usage });
      }
    });
    insert();
  }

  private waitingReplies(events: readonly EventRow[]): EventRow[] {
    const delivered = new Set(events.filter((event) => event.kind === "delivered").map((event) => Number(JSON.parse(event.data ?? "{}").replyId)));
    return events.filter((event) => event.kind === "reply" && !delivered.has(event.id));
  }

  /** The Bot's replies not yet picked up; marks them picked up. */
  poll(callId: string): { replies: { id: number; summary: string; note: string }[] } {
    const { row, events } = this.live(callId);
    const replies = this.waitingReplies(events).map((event) => {
      const summary = String(JSON.parse(event.data ?? "{}").summary ?? "");
      this.append(row.id, "delivered", { data: { replyId: event.id } });
      return { id: event.id, summary, note: botReplyNote(row.bot_name, summary) };
    });
    return { replies };
  }

  /**
   * A thread went idle. Calls that sent this Bot's chat something it hasn't
   * answered get its reply: an active call picks it up; after hang-up it goes
   * to the phone. Returns the calls it answered.
   */
  async idle(threadId: string, lastAssistantText: string | null | undefined): Promise<string[]> {
    if (!answered(lastAssistantText)) return [];
    const calls = this.deps.db.prepare("SELECT * FROM voice_calls WHERE thread_id = ? AND started_at >= ?").all(threadId, this.now() - WAIT_MS) as CallRow[];
    const answeredCalls: string[] = [];
    for (const row of calls) {
      const events = this.events(row.id);
      const lastSent = events.filter((event) => event.kind === "sent").at(-1)?.id ?? 0;
      const lastReply = events.filter((event) => event.kind === "reply").at(-1)?.id ?? 0;
      if (!lastSent || lastReply > lastSent) continue;
      const summary = replySummary(lastAssistantText!);
      this.append(row.id, "reply", { text: clip(lastAssistantText!.trim(), 20_000), data: { summary, afterCall: !!this.ended(events) } });
      answeredCalls.push(row.id);
      if (!this.ended(events)) this.deps.publish({ callId: row.id, kind: "reply" });
      else await this.deps.push({ title: `${row.bot_name} replied`, body: summary, threadId, coalesceKey: `voice-call:${row.id}` }).catch((error) => this.deps.warn?.(`Voice call push failed: ${String(error)}`));
    }
    return answeredCalls;
  }

  /** Hangs up: saves the last events and the record, and links it in the Bot's chat. Calling it again returns the record. */
  async end(callId: string, events: readonly CallEvent[] = []): Promise<VoiceCallView> {
    const row = this.call(callId);
    if (this.ended(this.events(callId))) return this.view(callId);
    this.save(callId, events);
    const endedAt = this.now();
    const draft = this.view(callId, endedAt);
    // A call that never got going (it didn't connect, nobody spoke) leaves no record in the chat.
    const empty = !draft.transcript.length && !draft.sent.length;
    let pageId: string | null = null;
    if (!empty) {
      try {
        pageId = this.deps.savePage({ title: callTitle(draft), markdown: callMarkdown(draft) });
      } catch (error) { this.deps.warn?.(`Couldn't save the call's page: ${String(error)}`); }
    }
    this.append(callId, "ended", { at: endedAt, data: { pageId } });
    const view = this.view(callId);
    if (row.thread_id && !empty) {
      await this.deps.send({
        threadId: row.thread_id, mode: "queue-if-active",
        text: callLine(view, pageId ? this.deps.pageHref(pageId) : null),
        note: "Studio's record of the user's voice call with you, already shown to them. Don't reply to it: reply exactly [PASS]. Anything the call sent you came as its own message.",
      }).catch((error) => this.deps.warn?.(`Couldn't post the call's record: ${String(error)}`));
    }
    this.deps.publish({ callId, kind: "ended" });
    return view;
  }

  view(callId: string, endedAtOverride?: number): VoiceCallView {
    const row = this.call(callId);
    const events = this.events(callId);
    const ended = this.ended(events);
    const endedAt = ended?.at ?? endedAtOverride ?? null;
    const pageId = ended ? ((JSON.parse(ended.data ?? "{}") as { pageId?: string | null }).pageId ?? null) : null;
    return {
      id: row.id, botId: row.bot_id, botName: row.bot_name, model: row.model, voice: row.voice,
      startedAt: row.started_at, endedAt,
      durationMs: (endedAt ?? this.now()) - row.started_at,
      costUsd: realtimePriceFor(row.model) ? this.cost(row, events) : null,
      transcript: events.filter((event) => event.kind === "transcript").map((event) => ({ role: event.role === "user" ? "user" as const : "assistant" as const, text: event.text ?? "", at: event.at })),
      sent: events.filter((event) => event.kind === "sent").map((event) => ({ message: event.text ?? "", at: event.at })),
      replies: events.filter((event) => event.kind === "reply").map((event) => ({ text: event.text ?? "", at: event.at })),
      pageId,
    };
  }
}

const clock = (at: number) => new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** "Call · 6 min": the record's name. */
export function callTitle(view: VoiceCallView): string {
  const day = new Date(view.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `Call with ${view.botName} · ${day}, ${clock(view.startedAt)} · ${callLength(view.durationMs)}`;
}

/** The line in the Bot's chat: the call at a glance, and its transcript's link. */
export function callLine(view: VoiceCallView, href: string | null): string {
  const parts = [`📞 **Call · ${callLength(view.durationMs)}**`];
  if (view.costUsd != null) parts.push(`≈${callUsd(view.costUsd)}`);
  if (view.sent.length) parts.push(`sent you ${view.sent.length} message${view.sent.length === 1 ? "" : "s"}`);
  if (href) parts.push(`[Transcript](${href})`);
  return parts.join(" · ");
}

/** The call's record as a page: what it cost, what it sent, and both sides' words in order. */
export function callMarkdown(view: VoiceCallView): string {
  const lines: { at: number; text: string }[] = [
    ...view.transcript.map((line) => ({ at: line.at, text: `**${line.role === "user" ? "You" : "Voice"}** (${clock(line.at)}): ${line.text}` })),
    ...view.sent.map((sent) => ({ at: sent.at, text: `→ **Sent to ${view.botName}** (${clock(sent.at)}): ${sent.message}` })),
    ...view.replies.map((reply) => ({ at: reply.at, text: `← **${view.botName} replied** (${clock(reply.at)}): ${clip(reply.text.replace(/\s+/g, " "), 1500)}` })),
  ].sort((a, b) => a.at - b.at);
  const summary = [callLength(view.durationMs), view.costUsd != null ? `about ${callUsd(view.costUsd)}` : "cost unknown", view.model, `voice ${view.voice}`].join(" · ");
  return [
    summary,
    "",
    `## Sent to ${view.botName}`,
    "",
    ...(view.sent.length ? view.sent.map((sent) => `- ${clock(sent.at)}: ${sent.message}`) : ["Nothing."]),
    "",
    "## Transcript",
    "",
    ...(lines.length ? lines.flatMap((line) => [line.text, ""]) : ["Nothing was said.", ""]),
  ].join("\n").trimEnd() + "\n";
}
