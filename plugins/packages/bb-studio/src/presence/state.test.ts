import { describe, expect, it } from "vitest";
import { botFacts, presenceSignal } from "./state";

describe("the presence's state", () => {
  it("is needs you first, then working with its worker count, then thinking, then idle", () => {
    expect(presenceSignal({ needsYou: false, turn: false, workers: 0 })).toEqual({ state: "idle", workers: 0 });
    expect(presenceSignal({ needsYou: false, turn: true, workers: 0 })).toEqual({ state: "thinking", workers: 0 });
    expect(presenceSignal({ needsYou: false, turn: true, workers: 3 })).toEqual({ state: "working", workers: 3 });
    expect(presenceSignal({ needsYou: false, turn: false, workers: 1 })).toEqual({ state: "working", workers: 1 });
    expect(presenceSignal({ needsYou: true, turn: true, workers: 2 })).toEqual({ state: "needs", workers: 2 });
  });

  it("reads the shown Bot from the sidebar's live rows", () => {
    const live = {
      botId: "cos",
      workers: [{ status: "running" }, { status: "running" }, { status: "done" }, { status: "failed" }],
      conversations: [{ running: true, needsYou: false }, { running: false, needsYou: false }],
    };
    expect(botFacts({ id: "cos", needsYou: false }, live)).toEqual({ needsYou: false, turn: true, workers: 2 });
    expect(presenceSignal(botFacts({ id: "cos" }, live))).toEqual({ state: "working", workers: 2 });
    expect(presenceSignal(botFacts({ id: "cos" }, { ...live, workers: [] }))).toEqual({ state: "thinking", workers: 0 });
    expect(presenceSignal(botFacts({ id: "cos" }, { ...live, workers: [{ status: "needs-you" }] })).state).toBe("needs");
    expect(presenceSignal(botFacts({ id: "cos" }, { ...live, conversations: [{ running: false, needsYou: true }] })).state).toBe("needs");
    expect(presenceSignal(botFacts({ id: "cos" }, { botId: "cos", workers: [], conversations: [] }))).toEqual({ state: "idle", workers: 0 });
  });

  it("reads another Bot from what the server says of it, never from the shown Bot's rows", () => {
    const live = { botId: "cos", workers: [{ status: "running" }], conversations: [{ running: true, needsYou: true }] };
    expect(botFacts({ id: "home" }, live)).toEqual({ needsYou: false, turn: false, workers: 0 });
    expect(presenceSignal(botFacts({ id: "home", needsYou: true }, live)).state).toBe("needs");
    expect(presenceSignal(botFacts({ id: "home", activity: { turn: true, workers: 0 } }, live))).toEqual({ state: "thinking", workers: 0 });
    expect(presenceSignal(botFacts({ id: "home", activity: { turn: false, workers: 2 } }, null))).toEqual({ state: "working", workers: 2 });
  });
});
