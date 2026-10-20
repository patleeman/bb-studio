// One voice call on the client, over any RealtimeTransport (transport.ts).
//
// - Server VAD turns the user's speech into turns. When the user starts
//   talking over a response, the response is cancelled (barge-in); OpenAI
//   trims the unplayed audio itself.
// - Push-to-talk turns server VAD off: the mic is live only while the button
//   is held, and letting go commits the audio and asks for a response.
// - The model's function calls go to the server (voice_call_tool); once the
//   response that made them is done, their outputs go back and a new
//   response is asked for.
// - Finished transcript lines and each response's usage are reported to the
//   server, which answers with the running cost.
// - When the Bot answers something the call sent it, the server says so
//   (realtime, or the replies count); the session picks the reply up and has
//   the voice say it once nothing else is in flight.
import type { CallEvent, VoiceCallView } from "../contract";
import type { RealtimeTransport, ServerEvent } from "./transport";

export interface CallServer {
  tool(name: string, args: string): Promise<string>;
  report(events: CallEvent[]): Promise<{ costUsd: number | null; replies: number }>;
  poll(): Promise<{ replies: { id: number; summary: string; note: string }[] }>;
  end(events: CallEvent[]): Promise<VoiceCallView>;
}

export type CallStatus = "live" | "ending" | "ended";

export interface CallSnapshot {
  status: CallStatus;
  startedAt: number;
  muted: boolean;
  pushToTalk: boolean;
  /** Push-to-talk's button is held. */
  talking: boolean;
  userSpeaking: boolean;
  /** A response is being made or played. */
  responding: boolean;
  costUsd: number | null;
  /** The last thing the model or the server refused, for the bar. */
  error: string | null;
  /** Requests sent to the Bot that it hasn't answered yet. */
  waiting: number;
  /** Set once it has ended. */
  record: VoiceCallView | null;
}

/** The server VAD the session starts with (session.ts sets the same). */
export const SERVER_VAD = { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 500, create_response: true, interrupt_response: true } as const;

const FLUSH_MS = 2000;
const POLL_MS = 5000;

export class CallSession {
  private snapshot: CallSnapshot;
  private readonly listeners = new Set<(snapshot: CallSnapshot) => void>();
  private queue: CallEvent[] = [];
  private tools: Promise<{ callId: string; output: string }>[] = [];
  private replies: { id: number; note: string }[] = [];
  private seenReplies = new Set<number>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  constructor(private readonly transport: RealtimeTransport, private readonly server: CallServer, private readonly options: { now?: () => number; timers?: boolean } = {}) {
    this.snapshot = { status: "live", startedAt: this.now(), muted: false, pushToTalk: false, talking: false, userSpeaking: false, responding: false, costUsd: null, error: null, waiting: 0, record: null };
    transport.onEvent((event) => this.handle(event));
    transport.onClose((reason) => { if (this.snapshot.status === "live") { this.update({ error: reason }); void this.hangUp(); } });
    transport.setMic(true);
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  get state(): CallSnapshot {
    return this.snapshot;
  }

  subscribe(listener: (snapshot: CallSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private update(patch: Partial<CallSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  private get live() {
    return this.snapshot.status === "live";
  }

  private micOn(): boolean {
    return this.snapshot.pushToTalk ? this.snapshot.talking : !this.snapshot.muted;
  }

  /** One server event. */
  handle(event: ServerEvent): void {
    if (!this.live) return;
    switch (event.type) {
      case "input_audio_buffer.speech_started":
        this.update({ userSpeaking: true });
        // Barge-in: server VAD interrupts too; cancelling makes sure no new audio follows.
        if (this.snapshot.responding) this.transport.send({ type: "response.cancel" });
        break;
      case "input_audio_buffer.speech_stopped":
        this.update({ userSpeaking: false });
        break;
      case "response.created":
        this.update({ responding: true });
        break;
      case "conversation.item.input_audio_transcription.completed": {
        const text = typeof event.transcript === "string" ? event.transcript : "";
        if (text.trim()) this.push({ type: "transcript", role: "user", text, at: this.now() });
        if (event.usage && typeof event.usage === "object") this.push({ type: "transcription_usage", usage: event.usage as never });
        break;
      }
      case "response.output_audio_transcript.done": {
        const text = typeof event.transcript === "string" ? event.transcript : "";
        if (text.trim()) this.push({ type: "transcript", role: "assistant", text, at: this.now() });
        break;
      }
      case "response.function_call_arguments.done": {
        const callId = String(event.call_id ?? "");
        const name = String(event.name ?? "");
        const args = typeof event.arguments === "string" ? event.arguments : "{}";
        if (!callId) break;
        if (name === "send_to_bot") this.update({ waiting: this.snapshot.waiting + 1 });
        this.tools.push(this.server.tool(name, args).then(
          (output) => {
            if (name === "send_to_bot" && output !== "sent") this.update({ waiting: Math.max(0, this.snapshot.waiting - 1) });
            return { callId, output };
          },
          (error: unknown) => {
            if (name === "send_to_bot") this.update({ waiting: Math.max(0, this.snapshot.waiting - 1) });
            return { callId, output: `That didn't work: ${error instanceof Error ? error.message : String(error)}` };
          },
        ));
        break;
      }
      case "response.done": {
        const response = (event.response ?? {}) as { usage?: unknown; status?: string };
        if (response.usage && typeof response.usage === "object") this.push({ type: "usage", usage: response.usage as never });
        this.update({ responding: false });
        void this.afterResponse();
        this.flushSoon(0);
        break;
      }
      case "error": {
        const error = (event.error ?? {}) as { message?: string; code?: string };
        // Cancelling when nothing is playing is harmless.
        if (error.code !== "response_cancel_not_active") this.update({ error: error.message ?? "OpenAI reported an error." });
        break;
      }
    }
  }

  /** A response finished: send its tools' outputs and ask for the next, or say a Bot reply that waited. */
  private async afterResponse() {
    if (this.tools.length) {
      const pending = this.tools;
      this.tools = [];
      const outputs = await Promise.all(pending);
      if (!this.live) return;
      for (const { callId, output } of outputs) {
        this.transport.send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output } });
      }
      this.transport.send({ type: "response.create" });
      this.update({ responding: true });
      return;
    }
    this.speakReply();
  }

  /** Says the next Bot reply, when nothing else is in flight. */
  private speakReply() {
    if (!this.live || this.snapshot.responding || this.tools.length || this.snapshot.talking) return;
    const reply = this.replies.shift();
    if (!reply) return;
    this.transport.send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: reply.note }] } });
    this.transport.send({ type: "response.create" });
    this.update({ responding: true });
  }

  private push(event: CallEvent) {
    this.queue.push(event);
    this.flushSoon(FLUSH_MS);
  }

  private flushSoon(ms: number) {
    if (this.options.timers === false) return;
    if (this.flushTimer) {
      if (ms > 0) return;
      clearTimeout(this.flushTimer);
    }
    this.flushTimer = setTimeout(() => { this.flushTimer = null; void this.flush(); }, ms);
  }

  /** Reports what's queued; picks up Bot replies the server holds. */
  async flush(): Promise<void> {
    if (!this.live || !this.queue.length) return;
    const events = this.queue;
    this.queue = [];
    try {
      const result = await this.server.report(events);
      this.update({ costUsd: result.costUsd });
      if (result.replies > 0) await this.pickUp();
    } catch (error) {
      this.queue = [...events, ...this.queue];
      this.update({ error: error instanceof Error ? error.message : String(error) });
    }
  }

  /** The server says the Bot replied: fetch the replies and say them. */
  async pickUp(): Promise<void> {
    if (!this.live || this.polling) return;
    this.polling = true;
    try {
      const { replies } = await this.server.poll();
      const fresh = replies.filter((reply) => !this.seenReplies.has(reply.id));
      for (const reply of fresh) this.seenReplies.add(reply.id);
      if (fresh.length) {
        this.replies.push(...fresh);
        this.update({ waiting: Math.max(0, this.snapshot.waiting - fresh.length) });
        this.speakReply();
      }
    } catch { /* The next signal or poll tries again. */ } finally {
      this.polling = false;
    }
  }

  /** Starts the fallback poll for Bot replies (the realtime signal is the fast path). */
  startPolling(): void {
    if (this.pollTimer || this.options.timers === false) return;
    this.pollTimer = setInterval(() => { if (this.snapshot.waiting > 0) void this.pickUp(); }, POLL_MS);
  }

  setMuted(muted: boolean): void {
    this.update({ muted });
    this.transport.setMic(this.micOn());
  }

  /** Push-to-talk on: server VAD off, the mic only while held. Off: back to server VAD. */
  setPushToTalk(on: boolean): void {
    if (!this.live || on === this.snapshot.pushToTalk) return;
    this.transport.send({ type: "session.update", session: { type: "realtime", audio: { input: { turn_detection: on ? null : SERVER_VAD } } } });
    this.update({ pushToTalk: on, talking: false });
    this.transport.setMic(this.micOn());
  }

  /** Push-to-talk's button went down: stop the voice, start a fresh turn. */
  pressTalk(): void {
    if (!this.live || !this.snapshot.pushToTalk || this.snapshot.talking) return;
    if (this.snapshot.responding) {
      this.transport.send({ type: "response.cancel" });
      this.transport.send({ type: "output_audio_buffer.clear" });
    }
    this.transport.send({ type: "input_audio_buffer.clear" });
    this.update({ talking: true });
    this.transport.setMic(true);
  }

  /** Push-to-talk's button came up: commit the turn and ask for a response. */
  releaseTalk(): void {
    if (!this.live || !this.snapshot.talking) return;
    this.update({ talking: false });
    this.transport.setMic(false);
    this.transport.send({ type: "input_audio_buffer.commit" });
    this.transport.send({ type: "response.create" });
    this.update({ responding: true });
  }

  /** Ends the call: the last events go with the hang-up, which saves the record. */
  async hangUp(): Promise<VoiceCallView | null> {
    if (this.snapshot.status !== "live") return this.snapshot.record;
    this.update({ status: "ending" });
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.transport.close();
    const events = this.queue;
    this.queue = [];
    try {
      const record = await this.server.end(events);
      this.update({ status: "ended", record, costUsd: record.costUsd });
      return record;
    } catch (error) {
      this.update({ status: "ended", error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }
}
