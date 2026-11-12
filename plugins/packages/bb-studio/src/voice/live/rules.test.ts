import { describe, expect, it } from "vitest";
import { classify, confirmPrompt, hallucinated, outwardKinds, relayNote, relayText, spokenAnswer } from "./rules";
import { resolveTarget } from "./targets";

describe("spokenAnswer", () => {
  it.each(["Yes", "yeah", "Yep, send it.", "go ahead", "Sure", "do it", "That's right"])("%s is a yes", (line) => {
    expect(spokenAnswer(line)).toBe("yes");
  });
  it.each(["no", "No, wait", "yes but change it to Thursday", "don't", "hold on", "actually make it Friday", "cancel"])("%s is a no", (line) => {
    expect(spokenAnswer(line)).toBe("no");
  });
  it.each(["", "um", "what did you say", "yes I think we should probably also talk about the budget later"])("%j is unclear", (line) => {
    expect(spokenAnswer(line)).toBe("unclear");
  });
  it("the voice's own question heard in the mic isn't a yes", () => {
    expect(spokenAnswer("Say yes to drop")).toBe("unclear");
    expect(spokenAnswer("Drop the todo? Say yes to drop.")).toBe("unclear");
  });
  it("yes with the action's own verb is a yes; a bare stop isn't", () => {
    expect(spokenAnswer("Yes, stop it")).toBe("yes");
    expect(spokenAnswer("Yes, drop it")).toBe("yes");
    expect(spokenAnswer("stop")).toBe("unclear");
  });
});

describe("outwardKinds", () => {
  it("finds the never-by-voice kinds", () => {
    expect(outwardKinds("Pause the eBay fetcher until Monday")).toEqual([]);
    expect(outwardKinds("buy two tickets")).toEqual(["spending money"]);
    expect(outwardKinds("email Dana the deck")).toEqual(["messaging people outside BB"]);
    expect(outwardKinds("tweet the launch")).toEqual(["posting publicly"]);
    expect(outwardKinds("approve the API key for the vendor")).toEqual(["approving credentials"]);
    // Deleting is a destructive action voice can confirm, not a never; asking a thread to tidy up is fine.
    expect(outwardKinds("delete the old branch")).toEqual([]);
  });
});

it("filters Whisper's silence hallucinations", () => {
  expect(hallucinated("Thank you for watching")).toBe(true);
  expect(hallucinated("Thank you, send it")).toBe(false);
});

it("relays one line, without the model's trailing period", () => {
  expect(relayText("  pause the\nfetcher ")).toBe("pause the fetcher");
  // GPT-Live's backend ends the message with its own period (live run, Nov 1).
  expect(relayText("Please pause the eBay fetcher until Monday.")).toBe("Please pause the eBay fetcher until Monday");
});

describe("classify", () => {
  it("reads, instant actions, confirm-only destructive ones, and nothing else", () => {
    expect(classify("todos_list")).toBe("read");
    expect(classify("read_replies")).toBe("read");
    for (const tool of ["send_to_cos", "send_to_thread", "todos_add", "undo", "confirm", "cancel"]) expect(classify(tool)).toBe("act");
    for (const action of ["done", "snooze", "hand_off"]) expect(classify("todos_act", { action })).toBe("act");
    expect(classify("todos_act", { action: "drop" })).toBe("confirm");
    for (const action of ["choose", "nudge", "keep", ""]) expect(classify("todos_act", { action })).toBe("unknown");
    // The names from before the rename classify the same.
    expect(classify("loops_list")).toBe("read");
    expect(classify("loops_add")).toBe("act");
    expect(classify("loops_act", { action: "done" })).toBe("act");
    expect(classify("loops_act", { action: "drop" })).toBe("confirm");
    for (const tool of ["stop_thread", "archive_thread", "pause_automation", "delete_automation"]) expect(classify(tool)).toBe("confirm");
    for (const tool of ["send_email", "purchase", "post", "approve_credentials", "delete_thread"]) expect(classify(tool)).toBe("unknown");
  });

  it("asks one plain question per destructive action", () => {
    expect(confirmPrompt("drop_loop", "Remove the stale Tailscale node")).toBe(`Drop the todo 'Remove the stale Tailscale node'? Say yes to drop.`);
    expect(confirmPrompt("delete_automation", "Morning brief")).toBe(`Delete the automation 'Morning brief'? It can't be undone. Say yes to delete.`);
  });
});

describe("resolveTarget", () => {
  const candidates = {
    cos: { name: "Dot", threadId: "thr_cos" },
    leads: [{ project: "Larkspur", threadId: "thr_k" }, { project: "Larkspur Web", threadId: "thr_kw" }, { project: "Home", threadId: "thr_h" }],
    threads: [{ id: "thr_1", title: "Launch review" }, { id: "thr_2", title: "Launch checklist" }, { id: "thr_3", title: "Dentist" }],
  };
  it("the Bot by role or name", () => {
    for (const name of ["the Bot", "CoS", "my chief of staff", "Dot"]) expect(resolveTarget(name, candidates)).toEqual([{ threadId: "thr_cos", title: "Dot" }]);
  });
  it("a project's lead, exact name first", () => {
    expect(resolveTarget("the Larkspur lead", candidates)).toEqual([{ threadId: "thr_k", title: "the Larkspur lead" }]);
    expect(resolveTarget("Larkspur's lead", candidates)).toEqual([{ threadId: "thr_k", title: "the Larkspur lead" }]);
    expect(resolveTarget("the home project lead", candidates)).toEqual([{ threadId: "thr_h", title: "the Home lead" }]);
  });
  it("a thread by title; several when it's ambiguous", () => {
    expect(resolveTarget("the dentist thread", candidates)).toEqual([{ threadId: "thr_3", title: "Dentist" }]);
    expect(resolveTarget("launch", candidates)).toHaveLength(2);
    expect(resolveTarget("launch review", candidates)).toEqual([{ threadId: "thr_1", title: "Launch review" }]);
    expect(resolveTarget("nothing like it", candidates)).toEqual([]);
  });
});

it("answer relay notes request a full speakable reply and preserve outward warnings", () => {
  expect(relayNote([], "answer")).toContain("Answer the question fully");
  expect(relayNote([], "answer")).toContain("no markdown, tables, links or code");
  for (const intent of ["answer", "do", "fyi"] as const) {
    expect(relayNote(["spending money"], intent)).toContain("This request involves spending money: ask first.");
    expect(relayNote([], intent)).toContain("don't spend money");
  }
  expect(relayNote([], "fyi")).toContain("short plain summary");
});
