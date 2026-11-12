import { expect, it } from "vitest";
import { CLICK_THROUGH_OFF, clickThroughShown, clickThroughStep, type ClickThroughEvent, type ClickThroughState } from "./click-through";

/** Runs events in order; answers the last state and everything asked of BB. */
function run(events: readonly ClickThroughEvent[], from: ClickThroughState = CLICK_THROUGH_OFF) {
  const asked: boolean[] = [];
  let state = from;
  for (const event of events) {
    const step = clickThroughStep(state, event);
    state = step.state;
    if (step.ask !== null) asked.push(step.ask);
  }
  return { state, asked };
}
const ON: ClickThroughState = { mode: "on", echoes: 0 };

it("starts off, and the eye asks BB to turn it on; it is on when BB says so", () => {
  expect(clickThroughShown(CLICK_THROUGH_OFF)).toBe(false);
  const asked = run([{ type: "toggle" }]);
  expect(asked).toEqual({ state: CLICK_THROUGH_OFF, asked: [true] });
  expect(run([{ type: "toggle" }, { type: "host", on: true }]).state).toEqual(ON);
});

it("goes off when BB's hotkey or menu bar entry turns it off", () => {
  expect(run([{ type: "host", on: false }], ON)).toEqual({ state: CLICK_THROUGH_OFF, asked: [] });
});

it("Esc turns it off for good, from on and from a peek", () => {
  expect(run([{ type: "escape" }], ON)).toEqual({ state: CLICK_THROUGH_OFF, asked: [false] });
  expect(run([{ type: "pointer", alt: true }, { type: "escape" }], ON)).toEqual({ state: CLICK_THROUGH_OFF, asked: [false, false] });
  // Nothing to do when it is off: Esc is the chat's.
  expect(run([{ type: "escape" }])).toEqual({ state: CLICK_THROUGH_OFF, asked: [] });
});

it("holding Option over the HUD makes it clickable, and it still says click-through is on", () => {
  const peek = run([{ type: "pointer", alt: true }], ON);
  expect(peek.asked).toEqual([false]);
  expect(peek.state.mode).toBe("peek");
  expect(clickThroughShown(peek.state)).toBe(true);
  // BB's answer to that request is not the user turning it off.
  expect(run([{ type: "host", on: false }], peek.state).state.mode).toBe("peek");
  // More movement with Option held asks nothing more.
  expect(run([{ type: "pointer", alt: true }], peek.state).asked).toEqual([]);
});

it("goes back to click-through when Option is let go, or the pointer leaves", () => {
  for (const back of [{ type: "pointer", alt: false }, { type: "release" }] as const) {
    const done = run([{ type: "pointer", alt: true }, { type: "host", on: false }, back, { type: "host", on: true }], ON);
    expect(done).toEqual({ state: ON, asked: [false, true] });
  }
});

it("ends on even when BB's answers arrive after the peek is over", () => {
  const late = run([{ type: "pointer", alt: true }, { type: "release" }, { type: "host", on: false }, { type: "host", on: true }], ON);
  expect(late.state).toEqual(ON);
  // After that a real "off" from BB is not mistaken for an answer.
  expect(run([{ type: "host", on: false }], late.state).state).toEqual(CLICK_THROUGH_OFF);
});

it("the eye turns it off during a peek, which is when it can be clicked", () => {
  expect(run([{ type: "pointer", alt: true }, { type: "toggle" }], ON)).toEqual({ state: CLICK_THROUGH_OFF, asked: [false, false] });
});

it("ignores the pointer and Option while it is off", () => {
  expect(run([{ type: "pointer", alt: true }, { type: "release" }, { type: "pointer", alt: false }])).toEqual({ state: CLICK_THROUGH_OFF, asked: [] });
});

// BB's hold mode (`setClickThrough(id, on, { hold: true })`): Option pauses
// passing clicks while click-through stays on for BB.
function runHold(events: readonly ClickThroughEvent[], from: ClickThroughState = ON) {
  const asked: (boolean | "pause" | "resume")[] = [];
  let state = from;
  for (const event of events) {
    const step = clickThroughStep(state, event, { hold: true });
    state = step.state;
    if (step.ask !== null) asked.push(step.hold ? (step.ask ? "resume" : "pause") : step.ask);
  }
  return { state, asked };
}

it("with BB's hold mode, Option pauses and letting go resumes: click-through is never turned off, and no answer is awaited", () => {
  const peek = runHold([{ type: "pointer", alt: true }]);
  expect(peek).toEqual({ state: { mode: "peek", echoes: 0 }, asked: ["pause"] });
  expect(clickThroughShown(peek.state)).toBe(true);
  expect(runHold([{ type: "pointer", alt: true }, { type: "pointer", alt: true }]).asked).toEqual(["pause"]);
  for (const back of [{ type: "pointer", alt: false }, { type: "release" }] as const) {
    expect(runHold([{ type: "pointer", alt: true }, back])).toEqual({ state: ON, asked: ["pause", "resume"] });
  }
});

it("with BB's hold mode, the menu bar entry or the hotkey during a pause turns click-through off at once", () => {
  // No "off" answer is expected for a pause, so this one is the user's.
  expect(runHold([{ type: "pointer", alt: true }, { type: "host", on: false }])).toEqual({ state: CLICK_THROUGH_OFF, asked: ["pause"] });
  // Letting go of Option after that asks for nothing: it stays off.
  expect(runHold([{ type: "pointer", alt: true }, { type: "host", on: false }, { type: "release" }]).asked).toEqual(["pause"]);
});

it("with BB's hold mode, the eye and Esc still turn it off for good, by a plain request", () => {
  expect(runHold([{ type: "pointer", alt: true }, { type: "toggle" }])).toEqual({ state: CLICK_THROUGH_OFF, asked: ["pause", false] });
  expect(runHold([{ type: "pointer", alt: true }, { type: "escape" }])).toEqual({ state: CLICK_THROUGH_OFF, asked: ["pause", false] });
  expect(runHold([{ type: "toggle" }], CLICK_THROUGH_OFF)).toEqual({ state: CLICK_THROUGH_OFF, asked: [true] });
});
