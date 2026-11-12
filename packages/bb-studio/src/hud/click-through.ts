// The HUD's click-through, as a state machine with no DOM in it. Click-through
// lets clicks reach the app under the HUD, and a window that can't be clicked
// needs ways back that don't need a click:
// - BB turns it off from the window's hotkey and its menu bar entry, and tells
//   the page (`host` below, the source of truth for on and off);
// - holding Option over the HUD makes it clickable for as long as it is held
//   ("peek"), and it goes back to passing clicks when Option is let go or the
//   pointer leaves. On a BB whose `setClickThrough` takes `{ hold: true }`
//   the peek only pauses passing clicks: click-through stays on for BB, so
//   its hotkey and menu bar entry still turn click-through off and never
//   hide the window, and BB sends no event for the pause. On an older BB the
//   peek turns click-through off natively and back on, and BB's "off" answers
//   to that are counted (`echoes`) so they aren't taken for the user's;
// - Esc turns it off for good.
// It starts off with every open and is never saved.

export interface ClickThroughState {
  /** "peek": on, and held clickable by Option. */
  mode: "off" | "on" | "peek";
  /** "Off" answers from BB still to come for a peek Studio asked for; they aren't the user turning it off. */
  echoes: number;
}

export type ClickThroughEvent =
  /** BB says the window's click-through changed. */
  | { type: "host"; on: boolean }
  /** The eye button. */
  | { type: "toggle" }
  /** The pointer moved over the HUD, with Option held or not. */
  | { type: "pointer"; alt: boolean }
  /** The pointer left the window, or Option was let go. */
  | { type: "release" }
  | { type: "escape" };

export interface ClickThroughStep {
  state: ClickThroughState;
  /** What to ask BB for (`setClickThrough`), or null for nothing. */
  ask: boolean | null;
  /** The request only pauses or resumes passing clicks (`{ hold: true }`): click-through stays on. */
  hold?: boolean;
}

export interface ClickThroughOptions {
  /** Whether BB's `setClickThrough` has the hold mode. */
  hold?: boolean;
}

export const CLICK_THROUGH_OFF: ClickThroughState = { mode: "off", echoes: 0 };

export function clickThroughStep(state: ClickThroughState, event: ClickThroughEvent, options: ClickThroughOptions = {}): ClickThroughStep {
  // With the hold mode a peek asks for a pause and gets no answer, so nothing is counted.
  const peek = (): ClickThroughStep => (options.hold ? { state: { ...state, mode: "peek" }, ask: false, hold: true } : { state: { mode: "peek", echoes: state.echoes + 1 }, ask: false });
  const resume = (): ClickThroughStep => ({ state: { ...state, mode: "on" }, ask: true, ...(options.hold ? { hold: true } : {}) });
  const same: ClickThroughStep = { state, ask: null };
  switch (event.type) {
    case "host":
      // On is on, whoever asked; it also settles any answer that never came.
      if (event.on) return { state: { mode: "on", echoes: 0 }, ask: null };
      if (state.echoes > 0) return { state: { ...state, echoes: state.echoes - 1 }, ask: null };
      // The hotkey or the menu bar entry turned it off.
      return { state: CLICK_THROUGH_OFF, ask: null };
    case "toggle":
      // Turning it on waits for BB's answer; turning it off shows at once.
      return state.mode === "off" ? { state, ask: true } : { state: CLICK_THROUGH_OFF, ask: false };
    case "pointer":
      if (state.mode === "on" && event.alt) return peek();
      if (state.mode === "peek" && !event.alt) return resume();
      return same;
    case "release":
      return state.mode === "peek" ? resume() : same;
    case "escape":
      return state.mode === "off" ? same : { state: CLICK_THROUGH_OFF, ask: false };
  }
}

/** Whether the HUD says click-through is on (a peek is still "on"). */
export const clickThroughShown = (state: ClickThroughState) => state.mode !== "off";
