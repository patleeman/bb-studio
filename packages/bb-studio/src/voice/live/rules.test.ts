import { describe, expect, it } from "vitest";
import { hallucinated, outwardKinds, readBack, spokenAnswer } from "./rules";
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
  it("the voice's own read-back heard in the mic isn't a yes", () => {
    expect(spokenAnswer("Say yes to send")).toBe("unclear");
  });
});

describe("outwardKinds", () => {
  it("finds the never-by-voice kinds", () => {
    expect(outwardKinds("Pause the eBay fetcher until Monday")).toEqual([]);
    expect(outwardKinds("buy two tickets")).toEqual(["spending money"]);
    expect(outwardKinds("email Dana the deck")).toEqual(["messaging people"]);
    expect(outwardKinds("tweet the launch")).toEqual(["posting or publishing"]);
    expect(outwardKinds("delete the old branch")).toEqual(["deleting"]);
    expect(outwardKinds("approve the permission request")).toEqual(["approving"]);
  });
});

it("filters Whisper's silence hallucinations", () => {
  expect(hallucinated("Thank you for watching")).toBe(true);
  expect(hallucinated("Thank you, send it")).toBe(false);
});

it("reads back who and what in one sentence", () => {
  expect(readBack("the Kensico lead", "  pause the\nfetcher ")).toBe("Send to the Kensico lead: pause the fetcher. Say yes to send.");
  // GPT-Live's backend ends the message with its own period (live run, Nov 1).
  expect(readBack("the Kensico lead", "Please pause the eBay fetcher until Monday.")).toBe("Send to the Kensico lead: Please pause the eBay fetcher until Monday. Say yes to send.");
});

describe("resolveTarget", () => {
  const candidates = {
    cos: { name: "Dot", threadId: "thr_cos" },
    leads: [{ project: "Kensico", threadId: "thr_k" }, { project: "Kensico Web", threadId: "thr_kw" }, { project: "Home", threadId: "thr_h" }],
    threads: [{ id: "thr_1", title: "Launch review" }, { id: "thr_2", title: "Launch checklist" }, { id: "thr_3", title: "Dentist" }],
  };
  it("the Bot by role or name", () => {
    for (const name of ["the Bot", "CoS", "my chief of staff", "Dot"]) expect(resolveTarget(name, candidates)).toEqual([{ threadId: "thr_cos", title: "Dot" }]);
  });
  it("a project's lead, exact name first", () => {
    expect(resolveTarget("the Kensico lead", candidates)).toEqual([{ threadId: "thr_k", title: "the Kensico lead" }]);
    expect(resolveTarget("Kensico's lead", candidates)).toEqual([{ threadId: "thr_k", title: "the Kensico lead" }]);
    expect(resolveTarget("the home project lead", candidates)).toEqual([{ threadId: "thr_h", title: "the Home lead" }]);
  });
  it("a thread by title; several when it's ambiguous", () => {
    expect(resolveTarget("the dentist thread", candidates)).toEqual([{ threadId: "thr_3", title: "Dentist" }]);
    expect(resolveTarget("launch", candidates)).toHaveLength(2);
    expect(resolveTarget("launch review", candidates)).toEqual([{ threadId: "thr_1", title: "Launch review" }]);
    expect(resolveTarget("nothing like it", candidates)).toEqual([]);
  });
});
