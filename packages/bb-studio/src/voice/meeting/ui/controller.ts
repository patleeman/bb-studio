// One meeting in the BB window: a hands-free LiveSession (src/voice/live/ui)
// talking to meeting.* instead of voiceLive.*, with the address gate on its
// audio and the stage's state (lookups, notes, what the room heard).
//
// After every change in the session it reads what's being said: her name in
// the room's words opens the gate; her words while it's open keep the
// follow-up window going; her words while it's shut are held back (muted,
// left off the captions) and she's told nobody asked. A timer shuts the gate
// when the window passes.
import type { Earcon } from "../../live/ui/machine";
import { LiveSession, playEarcon, type LiveServer } from "../../live/ui/session";
import type { Addressing } from "../shared";
import { AddressGate } from "./gate";

type Rpc = { call(method: string, input: unknown): Promise<unknown> };

export interface StageLookup { id: string; question: string; status: "running" | "answered" | "failed"; answer: string | null; threadId: string | null; at: number }
export interface StageNote { id: number; kind: "note" | "decision" | "action"; text: string; owner: string | null; at: number }
export interface StageView { lookups: StageLookup[]; notes: StageNote[]; costUsd: number | null }
export interface Caption { speaker: "room" | "agent"; text: string }

export interface MeetingServer extends LiveServer {
  view(input: { sessionId: string }): Promise<StageView>;
}

/** Studio's meeting.* RPCs as the session's server. */
export function meetingServer(rpc: Rpc): MeetingServer {
  const call = (method: string) => async (input: unknown = {}) => (await rpc.call(method, input)) as never;
  return {
    state: call("meeting.state"), start: call("meeting.start"), tool: call("meeting.tool"), event: call("meeting.event"),
    poll: call("meeting.poll"), end: call("meeting.end"), view: call("meeting.view"),
  };
}

/** In a room, a beep on every line heard would be noise: only start, end, errors and an answer arriving. */
const ROOM_EARCONS = new Set<Earcon>(["start", "end", "error", "sent"]);

export const heldBackNote = (name: string) =>
  `(Studio, not the room:) Nobody addressed you, so the room didn't hear that. Stay silent until someone says "${name}".`;
export const askNote = "(Studio, not the room:) Someone pressed Ask: what's said next is for you.";
export const quietNote = (on: boolean, name: string) =>
  on ? "(Studio, not the room:) You're on Quiet: say nothing at all, and call no tools, until you're told it's off."
    : `(Studio, not the room:) Quiet is off: answer again when someone says "${name}".`;

export interface ControllerOptions {
  now?: () => number;
  timers?: boolean;
  /** Overrides the session (tests). */
  session?: LiveSession;
  earcon?: (earcon: Earcon) => void;
}

export class MeetingController {
  readonly session: LiveSession;
  readonly gate: AddressGate;
  view: StageView = { lookups: [], notes: [], costUsd: null };
  /** What the room heard, newest last: her held-back words never appear. */
  captions: Caption[] = [];
  private seenLines = 0;
  /** Whether her current turn is being heard (decided when it starts). */
  private turnHeard: boolean | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private refreshing = false;
  private stopSession: () => void = () => {};

  constructor(private readonly server: MeetingServer, name: string, mode: Addressing, private readonly options: ControllerOptions = {}) {
    this.gate = new AddressGate(name, mode);
    this.session = options.session ?? new LiveSession(server, {
      now: options.now, timers: options.timers,
      earcon: (earcon) => { if (ROOM_EARCONS.has(earcon)) (options.earcon ?? playEarcon)(earcon); },
    });
    this.stopSession = this.session.subscribe(() => this.observe());
  }

  private now(): number {
    return (this.options.now?.() ?? Date.now()) / 1000;
  }

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

  get name(): string {
    return this.gate.name;
  }

  start(): void {
    this.session.setAudioGate(this.gate.isOpen(this.now()));
    this.session.start();
    if (this.options.timers !== false) this.timer = setInterval(() => this.tick(), 250);
  }

  stop(): void {
    this.session.stop();
    void this.refresh();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stopSession();
  }

  /** The Ask button: the next thing said is for her. */
  ask(): void {
    this.gate.ask(this.now());
    this.session.note(askNote, false);
    this.apply();
  }

  setQuiet(quiet: boolean): void {
    if (quiet === this.gate.quiet) return;
    this.gate.setQuiet(quiet);
    this.session.note(quietNote(quiet, this.name), false);
    this.apply();
  }

  /** A lookup's answer is in: the room asked for it, so she may say it. */
  async answerArrived(): Promise<void> {
    this.gate.answer(this.now());
    this.apply();
    await this.session.pickUp();
    await this.refresh();
  }

  /**
   * The window passing shuts the gate. Lines that end on a pause end in the
   * session's own tick, which doesn't notify, so new ones are read here too.
   */
  tick(): void {
    const open = this.gate.isOpen(this.now());
    if (this.session.machine.linesTotal !== this.seenLines || open !== this.wasOpen) return this.observe();
    this.session.setAudioGate(open);
  }

  private wasOpen = false;

  private apply() {
    this.session.setAudioGate(this.gate.isOpen(this.now()));
    this.changed();
  }

  /** Reads the session after each change: names, her turns, new lines, and the stage's lookups and notes. */
  private observe(): void {
    const { machine } = this.session;
    const now = this.now();
    if (machine.subtitle?.speaker === "user") this.gate.heard(machine.subtitle.text, now);
    // Her turn: heard or held back, decided once at its start.
    if (machine.speaking === "agent") {
      if (this.turnHeard === null) {
        this.turnHeard = this.gate.isOpen(now);
        if (!this.turnHeard) {
          this.gate.heldBack++;
          this.session.note(heldBackNote(this.name), false);
        }
      }
      if (this.turnHeard) this.gate.spoke(now);
    }
    // The machine keeps its last 60 lines; its running total says how many are new.
    const added = Math.min(machine.linesTotal - this.seenLines, machine.lines.length);
    const fresh = added > 0 ? machine.lines.slice(-added) : [];
    this.seenLines = machine.linesTotal;
    for (const line of fresh) {
      if (line.speaker === "user") {
        this.gate.heard(line.text, now);
        this.captions.push({ speaker: "room", text: line.text });
      } else if (this.turnHeard !== false && !line.text.startsWith("✓ ")) this.captions.push({ speaker: "agent", text: line.text });
    }
    if (machine.speaking !== "agent" && machine.phase.kind !== "agentSpeaking") this.turnHeard = null;
    this.captions = this.captions.slice(-40);
    this.wasOpen = this.gate.isOpen(now);
    this.session.setAudioGate(this.wasOpen);
    if (fresh.length || machine.phase.kind === "thinking") void this.refresh();
    this.changed();
  }

  /** The stage's lookups and notes, from Studio. */
  async refresh(): Promise<void> {
    const sessionId = this.sessionId;
    if (!sessionId || this.refreshing) return;
    this.refreshing = true;
    try {
      const view = await this.server.view({ sessionId });
      this.view = { lookups: view.lookups, notes: view.notes, costUsd: view.costUsd };
      this.changed();
    } catch { /* The next change tries again. */ } finally {
      this.refreshing = false;
    }
  }

  private get sessionId(): string | null {
    return this.session.id;
  }
}
