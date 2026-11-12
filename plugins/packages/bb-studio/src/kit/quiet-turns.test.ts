import { describe, expect, it } from "vitest";
import { registerQuietReplyClassifier, registerQuietTurnClassifier } from "./quiet-turns";

describe("quiet turn registration", () => {
  it("gives BB a turn classifier that calls exactly [PASS] quiet", () => {
    let classify: ((turn: { threadId: string; finalOutput: string | null }) => { quiet: boolean }) | null = null;
    const taken = registerQuietTurnClassifier({ experimental_hooks: { experimental_classifyTurns: (fn: typeof classify) => { classify = fn; } } });
    expect(taken).toBe(true);
    expect(classify!({ threadId: "t", finalOutput: " `[PASS]` " })).toEqual({ quiet: true });
    expect(classify!({ threadId: "t", finalOutput: "[PASS] and more" })).toEqual({ quiet: false });
    expect(classify!({ threadId: "t", finalOutput: null })).toEqual({ quiet: false });
  });

  it("gives BB a reply classifier with the same rule", () => {
    let classify: ((text: string) => { quiet: boolean }) | null = null;
    const taken = registerQuietReplyClassifier({ experimental_replyClassifier: (registration: { classify: typeof classify }) => { classify = registration.classify; } });
    expect(taken).toBe(true);
    expect(classify!("[pass]")).toEqual({ quiet: true });
    expect(classify!("Done.")).toEqual({ quiet: false });
  });

  it("does nothing on a BB without the hooks", () => {
    expect(registerQuietTurnClassifier({ experimental_hooks: {} })).toBe(false);
    expect(registerQuietTurnClassifier({})).toBe(false);
    expect(registerQuietReplyClassifier({})).toBe(false);
  });
});
