import { describe, expect, it } from "vitest";
import { DECIDE, summarizeAnswers, type QuestionForm } from "./questions";

const form: QuestionForm = {
  title: "A few questions",
  questions: [
    { id: "platform", kind: "choice", question: "Which platform?", options: [{ label: "iOS" }, { label: "Web" }] },
    { id: "flows", kind: "multi", question: "Which flows", options: [{ label: "Sign-up" }, { label: "Checkout" }] },
    { id: "brand", kind: "text", question: "Brand name:" },
    { id: "density", kind: "scale", question: "How dense?", minLabel: "airy", maxLabel: "packed" },
    { id: "look", kind: "choice", question: "Which look?", options: [{ label: "Calm" }, { label: "Bold" }] },
  ],
};

describe("question answers", () => {
  it("sum up as one line per question, in order", () => {
    expect(summarizeAnswers(form, { platform: "iOS", flows: ["Sign-up", "Checkout"], brand: "Forkful", density: 2, look: DECIDE })).toBe([
      "- Which platform: iOS",
      "- Which flows: Sign-up, Checkout",
      "- Brand name: Forkful",
      "- How dense: 2 of 5 (1 = airy, 5 = packed)",
      "- Which look: you decide",
    ].join("\n"));
  });

  it("leave missing and empty answers to the agent", () => {
    expect(summarizeAnswers(form, { brand: "  ", flows: [] })).toContain("- Brand name: you decide");
    expect(summarizeAnswers(form, { flows: [] })).toContain("- Which flows: none");
    expect(summarizeAnswers(form, {})).toContain("- Which platform: you decide");
  });
});
