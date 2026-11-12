// A hands-free session's state on the desktop: who's talking, the subtitles,
// the question a destructive action waits on, and barge-in (by level first,
// confirmed by the transcript). Pure: time comes in as epoch seconds and every
// side effect goes out as an Effect. The same machine as the iPhone's
// (ios/iOS/VoiceLive/Core/LiveSessionMachine.swift, BargeInGate.swift).
import type { LiveOutgoing, LiveSignal } from "./events";
import { voiceToolName } from "../shared";

export type Speaker = "user" | "agent";
export interface Subtitle { speaker: Speaker; text: string }
export interface ToolCard { kind: "waiting" | "sent" | "loop" | "reply" | "notice"; title: string; detail: string }

export type Phase =
  | { kind: "idle" } | { kind: "connecting" } | { kind: "listening" } | { kind: "userSpeaking" } | { kind: "thinking" } | { kind: "agentSpeaking" }
  | { kind: "paused"; why: string } | { kind: "ended"; why: string | null } | { kind: "failed"; why: string };

/** What Studio is told (voiceLive.event / .tool / .end), in its contract's shape. */
export type Report =
  /** A user line also says when its speech started, and the destructive action whose question it came after (answers). */
  | { type: "transcript"; role: "user" | "assistant"; text: string; at: number; started_at?: number; answers?: string }
  | { type: "interrupted"; heard: string; at: number }
  | { type: "live_usage"; seconds: number }
  | { type: "backend_usage"; input_tokens: number; cached_tokens: number; output_tokens: number }
  | { type: "usage"; usage: unknown }
  | { type: "transcription_usage"; usage: unknown };

export type Earcon = "start" | "heard" | "working" | "sent" | "error" | "end";

export type Effect =
  | { type: "connect" }
  | { type: "send"; outgoing: LiveOutgoing }
  | { type: "muteAgentAudio"; muted: boolean }
  | { type: "runTool"; callId: string; name: string; arguments: string; reports: Report[] }
  | { type: "hangUp"; reports: Report[] }
  | { type: "earcon"; earcon: Earcon };

/**
 * Barge-in by level: while the voice plays, a mic level that stays above the
 * voice's own echo for a moment counts as the user talking. Echo-safe: the bar
 * is higher while the voice plays and rises with its playback level; speech
 * must last minDuration. Levels are linear RMS, 0 to 1.
 */
export class BargeInGate {
  quietThreshold = 0.02;
  playingFloor = 0.035;
  echoRatio = 0.5;
  echoMargin = 0.02;
  minDuration = 0.12;
  private aboveSince: number | null = null;

  threshold(playback: number, voicePlaying: boolean): number {
    return voicePlaying ? Math.max(this.playingFloor, playback * this.echoRatio + this.echoMargin) : this.quietThreshold;
  }

  /** One mic frame. True once the user has been talking for minDuration. */
  feed(level: number, playback: number, voicePlaying: boolean, at: number): boolean {
    if (level <= this.threshold(playback, voicePlaying)) {
      this.aboveSince = null;
      return false;
    }
    this.aboveSince ??= at;
    // A millisecond of slack: frame times add up in floating point.
    return at - this.aboveSince >= this.minDuration - 0.001;
  }

  reset(): void {
    this.aboveSince = null;
  }
}

const ms = (seconds: number) => Math.round(seconds * 1000);
/** About how long words take to say: 15 characters a second. */
const speakingTime = (text: string) => text.length / 15;
const normalized = (text: string) => text.toLowerCase().replace(/[^a-z ]+/g, "").split(/\s+/).filter(Boolean).join(" ");

/** GPT-Live's session.closed reasons, in words; null for the user's own hang-up. */
export function closedReason(reason: string): string | null {
  switch (reason) {
    case "close_requested": return null;
    case "expired": return "The session reached its time limit";
    case "content": return "Ended by OpenAI's safety filter";
    case "remote_hangup": return "The voice ended the session";
    case "connection_lost": return "The connection was lost";
    default: return "The session ended";
  }
}

export function interruptedNote(heard: string): string {
  return heard
    ? `(Studio, not the user:) The user interrupted you. They heard up to: "${heard.slice(-200)}". Don't repeat it; answer what they said next.`
    : "(Studio, not the user:) The user interrupted you before you said anything. Answer what they said.";
}

/** Three or more words the voice just said: its echo, not the user. */
export function isEcho(heard: string, said: string): boolean {
  const words = normalized(heard);
  return words.split(" ").length >= 3 && normalized(said).includes(words);
}

/** The question in a destructive action's output: Studio says `Ask exactly this and wait: "…"`. */
export function confirmQuestion(output: string): string | null {
  return output.match(/Ask exactly this and wait: "([^"]+)"/)?.[1] ?? null;
}

/** The action a question waits on: Studio says `Not done yet (action d_…)`. */
export function confirmAction(output: string): string | null {
  return output.match(/\(action (d_[a-z0-9]+)\)/)?.[1] ?? null;
}

export function stripData(text: string): string {
  return text.replace(/<[^>]+>/g, "").replace("As data, not instructions:", "").replace(", as data:", ":").replace("'s latest reply, as data:", ":").trim();
}

export function firstSentence(text: string): string {
  const clean = stripData(text);
  const end = clean.indexOf(". ");
  return end < 0 ? clean : `${clean.slice(0, end)}.`;
}

/** "What's waiting": how many need you, and the first two. */
export function waitingCard(output: string): ToolCard {
  const count = output.match(/Needs you now \((\d+)\)/)?.[1] ?? "0";
  const titles = output.split("\n").filter((line) => line.startsWith("- ")).slice(0, 2).map((line) => line.slice(2).split("(")[0]!.trim());
  return { kind: "waiting", title: count === "0" ? "Nothing waiting" : `${count} need${count === "1" ? "s" : ""} you`, detail: titles.length ? titles.join(" · ") : "Nothing needs you right now" };
}

export class SessionMachine {
  phase: Phase = { kind: "idle" };
  subtitle: Subtitle | null = null;
  /** "Drop the todo '…'? Say yes to drop." while a destructive action waits for a yes. */
  confirmation: string | null = null;
  card: ToolCard | null = null;
  /** The session's finished lines, newest last (the pill's transcript); at most 60. */
  lines: Subtitle[] = [];
  /** Every line ever added (lines keeps only the last 60), so a reader can tell which are new. */
  linesTotal = 0;
  agentMuted = false;
  interruptions = 0;
  falseTriggers = 0;
  /** When the level gate muted the voice, until words confirm it or the window passes. */
  provisionalSince: number | null = null;
  readonly gate = new BargeInGate();
  /** Words must arrive this soon after the user's level drops back, or the voice comes back. */
  confirmWindow = 1.0;
  userPause = 0.9;
  /** GPT-Live pauses up to ~0.7 s between phrases of one reply. */
  agentPause = 0.9;

  private userText = "";
  private agentText = "";
  private lastUserAt = 0;
  private agentUntil = 0;
  private reports: Report[] = [];
  private recentAgent = "";
  private awaitingTurn = false;
  private lastAgentLine = "";
  private loudUntil = 0;
  /** The last mic frame that sounded like the user (above the gate's bar), for ending lines. */
  private lastLoudAt = 0;
  /** After an "answer" relay: the one "still waiting" note Studio wrote, and when it's due (epoch seconds). */
  private stillWaiting: { note: string; due: number } | null = null;
  /**
   * When the user's next line started: the first sign of it (the mic, Realtime's
   * speech start, its first words) since their last line ended. Transcripts come
   * late, so a line's words can arrive after the question it can't be answering.
   */
  private lineStart: number | null = null;
  private lineEnded = 0;
  /** The destructive action whose question went back to the model, and when: a line that starts after it can be the yes. */
  private question: { actionId: string; at: number } | null = null;

  /** Whether a "still waiting" note is due later (tests, the pill's trace). */
  get waitingOnReply(): boolean {
    return this.stillWaiting !== null;
  }

  /** GPT-Live and the mock have no end-of-line events: a pause ends a line. */
  constructor(public endsLinesOnPause = true) {}

  get isLive(): boolean {
    return !["idle", "ended", "failed"].includes(this.phase.kind);
  }

  /** Who the talking orb animates for. */
  get speaking(): Speaker | null {
    return this.phase.kind === "userSpeaking" ? "user" : this.phase.kind === "agentSpeaking" ? "agent" : null;
  }

  // Start and stop

  start(_now: number): Effect[] {
    if (this.isLive) return [];
    Object.assign(this, new SessionMachine(this.endsLinesOnPause));
    this.phase = { kind: "connecting" };
    return [{ type: "earcon", earcon: "start" }, { type: "connect" }];
  }

  stop(now: number): Effect[] {
    if (!this.isLive) return [];
    this.finishUser(now);
    this.finishAgent(now);
    this.phase = { kind: "ended", why: null };
    this.confirmation = null;
    this.stillWaiting = null;
    return [{ type: "send", outgoing: { type: "close" } }, { type: "hangUp", reports: this.drain() }, { type: "earcon", earcon: "end" }];
  }

  fail(why: string, now: number): Effect[] {
    const wasLive = this.isLive;
    this.finishUser(now);
    this.finishAgent(now);
    this.phase = { kind: "failed", why };
    this.confirmation = null;
    this.stillWaiting = null;
    return [...(wasLive ? [{ type: "hangUp" as const, reports: this.drain() }] : []), { type: "earcon", earcon: "error" }];
  }

  // The model's events

  handle(signal: LiveSignal, now: number): Effect[] {
    if (!this.isLive) {
      // session.close's answer brings the final usage after the hang-up: still Studio's to count.
      if (this.phase.kind === "ended" || this.phase.kind === "failed") this.usage(signal);
      return [];
    }
    switch (signal.type) {
      case "started":
        if (this.phase.kind === "connecting") this.phase = { kind: "listening" };
        return [];
      case "userSpeechStarted": {
        if (this.phase.kind === "paused") return [];
        const effects = this.phase.kind === "agentSpeaking" ? this.bargeIn(now) : [];
        this.phase = { kind: "userSpeaking" };
        this.lastUserAt = now;
        this.heardStart(now);
        this.subtitle = { speaker: "user", text: this.userText };
        return effects;
      }
      case "userText": return this.userHeard(signal.text, now);
      case "userLine":
        this.userText = signal.text;
        return this.finishUser(now);
      case "agentText": return this.agentSaid(signal.text, now);
      case "agentLineDone":
        this.finishAgent(now, true);
        return [];
      case "agentAudioStarted":
        this.agentUntil = Math.max(this.agentUntil, now + this.agentPause);
        if (this.phase.kind === "listening" || this.phase.kind === "thinking") this.phase = { kind: "agentSpeaking" };
        return [];
      case "agentAudioStopped":
        if (this.provisionalSince === null) this.finishAgent(now);
        return [];
      case "toolCall": {
        const effects = this.finishUser(now);
        this.finishAgent(now);
        this.phase = { kind: "thinking" };
        return [...effects, { type: "earcon", earcon: "working" }, { type: "runTool", callId: signal.callId, name: signal.name, arguments: signal.arguments, reports: this.drain() }];
      }
      case "liveUsage": case "backendUsage": case "realtimeUsage": case "transcriptionUsage":
        this.usage(signal);
        return [];
      case "closed":
        this.finishUser(now);
        this.finishAgent(now);
        this.phase = { kind: "ended", why: closedReason(signal.reason) };
        this.confirmation = null;
        this.stillWaiting = null;
        return [{ type: "hangUp", reports: this.drain() }, { type: "earcon", earcon: "end" }];
      case "error":
        this.card = { kind: "notice", title: "Voice service", detail: signal.message };
        return [{ type: "earcon", earcon: "error" }];
    }
  }

  private usage(signal: LiveSignal) {
    switch (signal.type) {
      case "liveUsage":
        this.reports = this.reports.filter((report) => report.type !== "live_usage");
        this.reports.push({ type: "live_usage", seconds: signal.seconds });
        break;
      case "backendUsage": this.reports.push({ type: "backend_usage", input_tokens: signal.input, cached_tokens: signal.cached, output_tokens: signal.output }); break;
      case "realtimeUsage": this.reports.push({ type: "usage", usage: signal.usage }); break;
      case "transcriptionUsage": this.reports.push({ type: "transcription_usage", usage: signal.usage }); break;
    }
  }

  /** A sign the user's next line has started (see lineStart). */
  private heardStart(at: number) {
    if (at > this.lineEnded) this.lineStart = Math.min(this.lineStart ?? at, at);
  }

  /**
   * Mic frames (linear RMS, oldest first, with their times) and the voice's
   * playback level. While the voice talks, the user's voice above its echo
   * mutes it at once; the transcript then confirms (userHeard) or the window
   * cancels it (tick).
   */
  micLevels(frames: { level: number; at: number }[], playback: number): Effect[] {
    // While the user is audibly talking, their line isn't over, however slowly the transcript comes.
    const playing = this.phase.kind === "agentSpeaking" && !this.agentMuted;
    for (const frame of frames) {
      if (frame.level <= this.gate.threshold(playback, playing)) continue;
      this.lastLoudAt = Math.max(this.lastLoudAt, frame.at);
      this.heardStart(frame.at);
    }
    if (this.provisionalSince !== null) {
      const bar = this.gate.threshold(0, true);
      for (const frame of frames) if (frame.at >= this.provisionalSince && frame.level > bar) this.loudUntil = Math.max(this.loudUntil, frame.at);
      return [];
    }
    if (!this.isLive || this.phase.kind !== "agentSpeaking" || this.agentMuted) {
      if (this.phase.kind !== "agentSpeaking") this.gate.reset();
      return [];
    }
    for (const frame of frames) {
      if (!this.gate.feed(frame.level, playback, true, frame.at)) continue;
      this.provisionalSince = frame.at;
      this.loudUntil = frame.at;
      this.agentMuted = true;
      this.gate.reset();
      return [{ type: "muteAgentAudio", muted: true }];
    }
    return [];
  }

  /** Ends lines on a pause, the voice's turn when its audio should be done, and level triggers no words confirmed. */
  tick(now: number): Effect[] {
    if (!this.isLive) return [];
    const effects: Effect[] = [];
    // A level trigger with no words after it: a false alarm (a cough, the car). Let the voice carry on.
    if (this.provisionalSince !== null && now - Math.max(this.provisionalSince, this.loudUntil) > this.confirmWindow) {
      this.provisionalSince = null;
      this.agentMuted = false;
      this.falseTriggers++;
      effects.push({ type: "muteAgentAudio", muted: false });
    }
    // GPT-Live's transcript of the user comes in bursts while the voice talks: a line ends on a pause in the words and in the mic.
    if (this.endsLinesOnPause && this.phase.kind === "userSpeaking" && this.userText && now - this.lastUserAt > this.userPause && now - this.lastLoudAt > this.userPause) effects.push(...this.finishUser(now));
    if (this.phase.kind === "agentSpeaking" && this.provisionalSince === null && now > this.agentUntil && (this.endsLinesOnPause || !this.agentText)) this.finishAgent(now);
    // No reply yet to an "answer" relay: the voice says so once, when neither it nor the user is talking.
    if (this.stillWaiting && now >= this.stillWaiting.due && (this.phase.kind === "listening" || this.phase.kind === "thinking") && this.provisionalSince === null) {
      effects.push({ type: "send", outgoing: { type: "note", text: this.stillWaiting.note, spoken: true } });
      this.stillWaiting = null;
    }
    return effects;
  }

  /** Lines and usage not yet reported. */
  drain(): Report[] {
    const reports = this.reports;
    this.reports = [];
    return reports;
  }

  /** Reports Studio didn't get (a failed sync, tool or end): back in front, in their order, for the next try. */
  requeue(reports: readonly Report[]): void {
    this.reports = [...reports, ...this.reports];
  }

  // Studio's side

  /** A tool's output: its card, or the question a destructive action waits on; then back to the model (now). */
  toolFinished(callId: string, name: string, output: string, now: number): Effect[] {
    const effects: Effect[] = [{ type: "send", outgoing: { type: "toolResult", callId, output } }];
    const question = confirmQuestion(output);
    if (question) {
      this.confirmation = question;
      const actionId = confirmAction(output);
      this.question = actionId ? { actionId, at: now } : null;
      this.card = null;
      return effects;
    }
    switch (voiceToolName(name)) {
      case "send_to_cos": case "send_to_thread":
        if (output.startsWith("Sent to ")) {
          this.card = { kind: "sent", title: `Sent to ${output.slice("Sent to ".length).split(".")[0]}`, detail: "" };
          this.line({ speaker: "agent", text: `✓ ${this.card.title}` });
          effects.push({ type: "earcon", earcon: "sent" });
        } else this.card = { kind: "notice", title: "Which thread?", detail: firstSentence(output) };
        break;
      case "confirm": {
        if (output.includes("hasn't heard") || output.includes("didn't hear a clear yes")) break;
        this.confirmation = null;
        this.question = null;
        const undone = output.includes("nothing was done") || output.includes("cancelled") || output.includes("timed out");
        this.card = undone ? { kind: "notice", title: "Not done", detail: firstSentence(output) } : { kind: "loop", title: firstSentence(output), detail: "" };
        if (!undone) effects.push({ type: "earcon", earcon: "sent" });
        break;
      }
      case "cancel":
        this.confirmation = null;
        this.question = null;
        this.card = { kind: "notice", title: "Not done", detail: "Cancelled" };
        break;
      case "todos_list": this.card = waitingCard(output); break;
      case "todos_act": case "todos_add": {
        const refused = output.startsWith("Voice can");
        this.card = { kind: refused ? "notice" : "loop", title: firstSentence(output), detail: refused ? "" : "Say “undo” to undo" };
        break;
      }
      case "undo": this.card = { kind: "loop", title: firstSentence(output), detail: "" }; break;
      case "read_replies": this.card = { kind: "reply", title: "Reply", detail: stripData(output) }; break;
      case "stop_thread": case "archive_thread": case "pause_automation": case "delete_automation":
        this.card = { kind: "notice", title: "Which one?", detail: firstSentence(output) };
        break;
      default: this.card = { kind: "notice", title: "Not by voice", detail: firstSentence(output) };
    }
    return effects;
  }

  /**
   * After an "answer" relay (voiceLive.tool's waitFor): if no reply comes
   * within `ms`, tick adds Studio's note once so the voice says it's still
   * waiting. A reply, the user's next line or the end of the session cancels
   * it; a newer relay replaces it.
   */
  waitForReply(waitFor: { note: string; ms: number }, now: number): void {
    if (!this.isLive) return;
    this.stillWaiting = { note: waitFor.note, due: now + waitFor.ms / 1000 };
  }

  /** A relayed thread answered: the voice says it now. */
  reply(title: string, summary: string, note: string): Effect[] {
    if (!this.isLive) return [];
    this.stillWaiting = null;
    this.card = { kind: "reply", title: `${title} answered`, detail: summary };
    return [{ type: "earcon", earcon: "sent" }, { type: "send", outgoing: { type: "note", text: note, spoken: true } }];
  }

  // Lines

  private userHeard(delta: string, now: number): Effect[] {
    const effects: Effect[] = [];
    if (this.phase.kind === "agentSpeaking" || this.provisionalSince !== null) {
      // The voice's own words leaking into the mic aren't the user.
      if (isEcho(this.userText + delta, `${this.recentAgent} ${this.agentText}`)) return [];
      effects.push(...this.bargeIn(now));
    }
    if (this.phase.kind === "paused") return [];
    this.heardStart(now);
    this.userText += delta;
    this.lastUserAt = now;
    this.phase = { kind: "userSpeaking" };
    this.subtitle = { speaker: "user", text: this.userText.trim() };
    return effects;
  }

  private agentSaid(delta: string, now: number): Effect[] {
    // After a barge-in, what's left of the cut-off reply isn't shown or heard.
    if (this.awaitingTurn) return [];
    const effects: Effect[] = [];
    if (this.phase.kind === "userSpeaking") effects.push(...this.finishUser(now));
    // Muted by a level trigger that's waiting for words: the voice stays quiet meanwhile.
    if (this.provisionalSince !== null) {
      this.agentText += delta;
      this.agentUntil = Math.max(this.agentUntil, now + this.agentPause) + speakingTime(delta);
      return effects;
    }
    if (this.agentMuted) {
      this.agentMuted = false;
      effects.push({ type: "muteAgentAudio", muted: false });
    }
    this.agentText += delta;
    this.agentUntil = Math.max(this.agentUntil, now + this.agentPause) + speakingTime(delta);
    this.phase = { kind: "agentSpeaking" };
    this.subtitle = { speaker: "agent", text: this.agentText.trim() };
    return effects;
  }

  /** The user talked over the voice: silence it now, record where it was cut off, and tell the model. */
  private bargeIn(now: number): Effect[] {
    const heard = (this.agentText || this.lastAgentLine).trim();
    this.finishAgent(now);
    this.reports.push({ type: "interrupted", heard, at: ms(now) });
    this.interruptions++;
    this.provisionalSince = null;
    this.agentMuted = true;
    this.awaitingTurn = true;
    this.agentUntil = 0;
    return [{ type: "muteAgentAudio", muted: true }, { type: "send", outgoing: { type: "note", text: interruptedNote(heard), spoken: false } }];
  }

  private finishUser(now: number): Effect[] {
    const text = this.userText.trim();
    this.userText = "";
    if (!text) return [];
    const started = Math.min(this.lineStart ?? now, now);
    this.lineStart = null;
    this.lineEnded = now;
    this.awaitingTurn = false;
    this.lastAgentLine = "";
    if (this.phase.kind === "userSpeaking") this.phase = { kind: "thinking" };
    if (isEcho(text, this.recentAgent)) return [];
    // The user moved on: a new request, not a wait to remind them of.
    this.stillWaiting = null;
    // Only a line that started after the question went back can answer it (Studio checks: answers).
    const answers = this.question && started >= this.question.at ? { answers: this.question.actionId } : {};
    this.reports.push({ type: "transcript", role: "user", text, at: ms(now), started_at: ms(started), ...answers });
    this.line({ speaker: "user", text });
    return [{ type: "earcon", earcon: "heard" }];
  }

  private finishAgent(now: number, keepSpeaking = false): void {
    const text = this.agentText.trim();
    this.agentText = "";
    if (this.phase.kind === "agentSpeaking" && !keepSpeaking) this.phase = { kind: "listening" };
    if (!text) return;
    this.lastAgentLine = text;
    this.recentAgent = `${this.recentAgent} ${text}`.slice(-400);
    this.reports.push({ type: "transcript", role: "assistant", text, at: ms(now) });
    this.line({ speaker: "agent", text });
  }

  private line(line: Subtitle) {
    this.linesTotal++;
    this.lines = [...this.lines, line].slice(-60);
  }
}
