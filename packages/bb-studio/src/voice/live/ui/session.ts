// One hands-free session in the BB window: one click to start, then no
// clicks. Runs the session machine (machine.ts), the WebRTC or mock transport
// (transport.ts), the relay of tool calls to Studio (voiceLive.tool), the
// reply pick-up, the level-based barge-in and earcons. The same flow as the
// iPhone's VoiceLiveController.
import { encodeOutgoing, parseEvent, type LiveProtocol } from "./events";
import { SessionMachine, type Earcon, type Effect, type Report } from "./machine";
import { connectMock, connectWebRtc, realtimeExchange, type LiveTransport } from "./transport";

/** Studio's side (voiceLive.*). */
export interface LiveServer {
  state(): Promise<{ ready: boolean; problem: string | null; model: string; cosName: string | null }>;
  start(input: { model?: string; sdp?: string }): Promise<{ sessionId: string; model: string; transport: string; answerSdp: string | null; clientSecret: string | null; callsUrl: string | null; mockUrl: string | null; cosName: string }>;
  tool(input: { sessionId: string; name: string; args: string; events: Report[] }): Promise<{ output: string }>;
  event(input: { sessionId: string; events: Report[] }): Promise<{ costUsd: number | null; replies: number; stop: string | null; voiceThreadId?: string | null }>;
  poll(input: { sessionId: string }): Promise<{ replies: { id: number; title: string; summary: string; note: string }[] }>;
  end(input: { sessionId: string; events: Report[] }): Promise<unknown>;
}

export interface SessionOptions {
  now?: () => number;
  /** Tests run without timers and drive tick() and sync() themselves. */
  timers?: boolean;
  /** Overrides the transports (tests). */
  connect?: (start: (sdp?: string) => ReturnType<LiveServer["start"]>, model: string) => Promise<{ transport: LiveTransport; started: Awaited<ReturnType<LiveServer["start"]>> }>;
  earcon?: (earcon: Earcon) => void;
}

/** What happened when, for measuring (window.__studioVoiceLive in staged runs). */
export interface TraceEntry { at: number; what: string }

export class LiveSession {
  readonly machine = new SessionMachine(true);
  model = "gpt-live-1";
  costUsd: number | null = null;
  micLabel = "";
  /** The session's voice thread, once Studio has opened it: the pill links to it. */
  voiceThreadId: string | null = null;
  readonly trace: TraceEntry[] = [];
  private transport: LiveTransport | null = null;
  private sessionId: string | null = null;
  private protocol: LiveProtocol = "live";
  private timers: ReturnType<typeof setInterval>[] = [];
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private syncing = false;

  constructor(private readonly server: LiveServer, private readonly options: SessionOptions = {}) {}

  private now(): number {
    return (this.options.now?.() ?? Date.now()) / 1000;
  }

  /** For useSyncExternalStore: a number that changes on every update. */
  get snapshot(): number {
    return this.version;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed() {
    this.version++;
    for (const listener of this.listeners) listener();
  }

  private log(what: string) {
    this.trace.push({ at: Date.now(), what });
  }

  start(): void {
    this.apply(this.machine.start(this.now()));
  }

  stop(): void {
    this.apply(this.machine.stop(this.now()));
  }

  private apply(effects: Effect[]) {
    for (const effect of effects) {
      switch (effect.type) {
        case "connect": void this.connect(); break;
        case "send": for (const event of encodeOutgoing(effect.outgoing, this.protocol)) this.transport?.send(event); break;
        case "muteAgentAudio":
          this.log(effect.muted ? "voice muted" : "voice unmuted");
          this.transport?.setAgentAudio(!effect.muted);
          break;
        case "runTool": void this.runTool(effect.callId, effect.name, effect.arguments, effect.reports); break;
        case "hangUp": void this.hangUp(effect.reports); break;
        case "earcon": (this.options.earcon ?? playEarcon)(effect.earcon); break;
      }
    }
    this.changed();
  }

  /** One message from the voice model. */
  receive(event: Record<string, unknown>): void {
    for (const signal of parseEvent(event)) {
      if (signal.type === "started") this.log("session started");
      if (signal.type === "userText") this.log(`user text: ${signal.text}`);
      if (signal.type === "agentText") this.log(`voice text: ${signal.text}`);
      this.apply(this.machine.handle(signal, this.now()));
    }
  }

  private async connect() {
    this.log("connect");
    try {
      const state = await this.server.state();
      if (!state.ready) throw new Error(state.problem ?? "Hands-free voice isn't set up.");
      this.model = state.model;
      const start = (sdp?: string) => this.server.start({ model: state.model, ...(sdp ? { sdp } : {}) });
      const { transport, started } = await (this.options.connect ?? defaultConnect)(start, state.model);
      this.sessionId = started.sessionId;
      this.protocol = started.transport === "realtime-webrtc" ? "realtime" : "live";
      this.machine.endsLinesOnPause = this.protocol === "live";
      this.micLabel = transport.micLabel;
      if (transport.micOpenedAt) this.trace.push({ at: transport.micOpenedAt, what: "mic open" });
      this.transport = transport;
      transport.onEvent((event) => this.receive(event));
      transport.onClose((reason) => { if (this.machine.isLive) this.apply(this.machine.fail(reason, this.now())); });
      this.startTimers();
      this.changed();
    } catch (error) {
      this.apply(this.machine.fail(error instanceof Error ? error.message : String(error), this.now()));
      this.transport?.close();
      this.transport = null;
    }
  }

  private startTimers() {
    if (this.options.timers === false) return;
    this.timers = [
      // Levels for barge-in, lines ending on a pause, the voice's turn ending.
      setInterval(() => this.tick(), 50),
      // Transcript and usage to Studio; replies back; the cap.
      setInterval(() => void this.sync(), 3000),
    ];
  }

  /** Mic levels into the barge-in gate, then the machine's clock. */
  tick(): void {
    if (!this.machine.isLive || !this.transport) return;
    const now = this.now();
    const { mic, playback } = this.transport.levels();
    const frames = mic.map((level, index) => ({ level, at: now - (mic.length - 1 - index) * 0.02 }));
    const effects = [...this.machine.micLevels(frames, playback), ...this.machine.tick(now)];
    if (effects.length) this.apply(effects);
  }

  async sync(): Promise<void> {
    if (!this.sessionId || !this.machine.isLive || this.syncing) return;
    this.syncing = true;
    try {
      const result = await this.server.event({ sessionId: this.sessionId, events: this.machine.drain() });
      this.costUsd = result.costUsd;
      this.voiceThreadId = result.voiceThreadId ?? this.voiceThreadId;
      if (result.stop) {
        this.apply(this.machine.handle({ type: "error", message: result.stop }, this.now()));
        this.stop();
        return;
      }
      if (result.replies > 0) await this.pickUp();
      this.changed();
    } catch { /* The next sync tries again. */ } finally {
      this.syncing = false;
    }
  }

  /** Studio says a relayed thread answered: say it now. */
  async pickUp(): Promise<void> {
    if (!this.sessionId || !this.machine.isLive) return;
    const { replies } = await this.server.poll({ sessionId: this.sessionId });
    for (const reply of replies) this.apply(this.machine.reply(reply.title, reply.summary, reply.note));
  }

  private async runTool(callId: string, name: string, args: string, reports: Report[]) {
    if (!this.sessionId) return;
    this.log(`tool ${name}`);
    let output: string;
    try {
      output = (await this.server.tool({ sessionId: this.sessionId, name, args, events: reports })).output;
    } catch (error) {
      output = `Studio couldn't run that: ${error instanceof Error ? error.message : String(error)}`;
    }
    this.apply(this.machine.toolFinished(callId, name, output));
  }

  private async hangUp(reports: Report[]) {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
    if (this.sessionId) await this.server.end({ sessionId: this.sessionId, events: reports }).catch(() => {});
    // Let session.close reach the model (it answers with final usage), then drop the line.
    setTimeout(() => { this.transport?.close(); this.transport = null; }, 400);
    this.changed();
  }
}

/** The real transports: WebRTC (Studio exchanges gpt-live-1's offer; Realtime posts it with a secret), or the staged mock. */
async function defaultConnect(start: (sdp?: string) => ReturnType<LiveServer["start"]>, model: string) {
  if (model !== "gpt-live-1") {
    const started = await start();
    if (started.transport === "mock" && started.mockUrl) return { transport: await connectMock(started.mockUrl), started };
    const transport = await connectWebRtc({ exchange: (offer) => realtimeExchange(offer, started.callsUrl!, started.clientSecret!) });
    return { transport, started };
  }
  let started: Awaited<ReturnType<LiveServer["start"]>> | null = null;
  // Ask Studio first without an offer: a staged mock answers at once, and only a real session needs the mic.
  try {
    const probe = await start();
    if (probe.transport === "mock" && probe.mockUrl) return { transport: await connectMock(probe.mockUrl), started: probe };
  } catch { /* gpt-live-1 needs the offer: expected. */ }
  const transport = await connectWebRtc({
    exchange: async (offer) => {
      started = await start(offer);
      if (!started.answerSdp) throw new Error("Studio didn't return the voice connection.");
      return started.answerSdp;
    },
  });
  return { transport, started: started! };
}

let earconContext: AudioContext | null = null;

/** Short tones for start, heard, working, sent, errors and end: state without looking. */
export function playEarcon(earcon: Earcon): void {
  if (typeof AudioContext === "undefined") return;
  earconContext ??= new AudioContext();
  const context = earconContext;
  const steps: Record<Earcon, [number, number][]> = {
    start: [[660, 0.08], [880, 0.12]], heard: [[990, 0.05]], working: [[520, 0.05], [0, 0.05], [520, 0.05]],
    sent: [[784, 0.08], [1175, 0.14]], error: [[330, 0.18], [247, 0.22]], end: [[880, 0.08], [660, 0.12]],
  };
  let at = context.currentTime;
  for (const [frequency, seconds] of steps[earcon]) {
    if (frequency) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.12, at + 0.01);
      gain.gain.linearRampToValueAtTime(0, at + seconds);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + seconds);
    }
    at += seconds;
  }
}
