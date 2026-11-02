// Whether the room may hear Iris right now. Pure: time comes in as epoch
// seconds. GPT-Live has no listen-only setting (it can answer every turn), so
// her instructions ask her to stay quiet unless addressed, and this gate is
// the guarantee: while it's shut her audio is muted in the app, which
// OpenAI's delegation guide names as the way to guarantee silence.
//
// - Her name opens it: in a line as it's being heard (so her answer isn't
//   clipped while the transcript catches up) or a finished one.
// - It stays open for a follow-up window after her name and after each thing
//   she says, so "and the week before?" needs no name.
// - Ask (the big button) opens it like her name.
// - "judge": she decides for herself, so the gate is open unless Quiet.
// - Quiet shuts it, whatever else happens.
// - A lookup's answer opens it: the room asked for it.
import { FOLLOW_UP_SECONDS, saysName, type Addressing } from "../shared";

export type GateReason = "name" | "follow-up" | "ask" | "answer" | "judge";

export class AddressGate {
  quiet = false;
  /** Until when (epoch seconds) she may speak without the name. */
  openUntil = 0;
  /** Turns she started while the gate was shut: held back, the room never heard them. */
  heldBack = 0;
  private reason: GateReason | null = null;

  constructor(public name: string, public mode: Addressing, public followUp = FOLLOW_UP_SECONDS) {}

  /** Why she may speak now, or null when she may not. */
  why(now: number): GateReason | null {
    if (this.quiet) return null;
    if (now < this.openUntil) return this.reason;
    return this.mode === "judge" ? "judge" : null;
  }

  isOpen(now: number): boolean {
    return this.why(now) !== null;
  }

  private open(now: number, reason: GateReason) {
    // On Quiet nothing opens it, so turning Quiet off doesn't let a stale "Iris" through.
    if (this.quiet) return;
    this.openUntil = Math.max(this.openUntil, now + this.followUp);
    this.reason = reason;
  }

  /** A line from the room, partial or finished. True when it said her name. */
  heard(text: string, now: number): boolean {
    if (this.quiet || !saysName(text, this.name)) return false;
    this.open(now, "name");
    return true;
  }

  /** She's speaking (and being heard): the follow-up window runs from her last words. */
  spoke(now: number): void {
    if (this.isOpen(now)) this.open(now, "follow-up");
  }

  ask(now: number): void {
    this.open(now, "ask");
  }

  answer(now: number): void {
    this.open(now, "answer");
  }

  setQuiet(quiet: boolean): void {
    this.quiet = quiet;
    if (quiet) this.openUntil = 0;
  }
}
