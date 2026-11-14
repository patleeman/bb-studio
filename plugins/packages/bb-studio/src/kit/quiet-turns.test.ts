import { describe, expect, it } from "vitest";
import { classifyRelayedMessage, registerQuietReplyClassifier, registerQuietTurnClassifier } from "./quiet-turns";

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

  it("tells BB which messages came from elsewhere, with their sender and where the line starts", () => {
    let registration: { classifyMessage?: typeof classifyRelayedMessage } | null = null;
    registerQuietReplyClassifier({ experimental_replyClassifier: (each: typeof registration) => { registration = each; } });
    expect(registration!.classifyMessage).toBe(classifyRelayedMessage);
    const relay = "[bb message from thread:thr_lead0001]\n\nLEAD bb-studio: shipped.";
    expect(classifyRelayedMessage(relay, { part: "message", initiator: "agent" })).toEqual({ previewStart: relay.indexOf("shipped.") });
    expect(classifyRelayedMessage("LEAD bb-studio: shipped.", { part: "body", initiator: null })).toEqual({ previewStart: "LEAD bb-studio: ".length });
    expect(classifyRelayedMessage("From runner House: Door open.", { part: "body", initiator: null })).toEqual({ sender: "runner House", previewStart: "From runner House: ".length });
    expect(classifyRelayedMessage("[bb studio] Watcher Inbox: 3 new", { part: "message", initiator: "user" })).toEqual({ sender: "watcher Inbox", previewStart: "[bb studio] Watcher Inbox: ".length });
    expect(classifyRelayedMessage("Watcher Inbox: 3 new", { part: "message", initiator: "user" })).toBeNull();
    const due = "[bb automation due:aut_1]\n\nCheck-in \"Daily\": Plan.";
    expect(classifyRelayedMessage(due, { part: "message", initiator: "user" })).toEqual({ sender: "Daily", previewStart: due.indexOf("Check-in") });
    expect(classifyRelayedMessage("Status?", { part: "message", initiator: "user" })).toBeNull();
    expect(classifyRelayedMessage("Why does [bb message from thread:thr_x] show?", { part: "message", initiator: "user" })).toBeNull();
  });
});
