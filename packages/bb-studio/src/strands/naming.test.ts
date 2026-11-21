import { describe, expect, it } from "vitest";
import { checkName, firstLineTitle, isGoodName, NAME_EXAMPLES, NAMING_RULES, tidyName } from "./naming";
import { namingPrompt, proposePrompt, readNaming, readProposal, taskTitle } from "./sort";

describe("strand names (decision 8)", () => {
  it("accepts the plan's good examples and refuses its bad ones", () => {
    for (const name of NAME_EXAMPLES.good) expect(checkName(name), name).toEqual([]);
    for (const { name } of NAME_EXAMPLES.bad) expect(isGoodName(name), name).toBe(false);
  });

  it("the prompts carry the same rule and examples the check enforces", () => {
    const prompts = [NAMING_RULES, namingPrompt({ fresh: [{ key: "n1", messages: ["x"] }], open: [], refresh: [] }), proposePrompt(["x"], [])];
    for (const prompt of prompts) {
      for (const name of NAME_EXAMPLES.good) expect(prompt).toContain(`"${name}"`);
      for (const { name } of NAME_EXAMPLES.bad) expect(prompt).toContain(`"${name}"`);
      expect(prompt).toMatch(/1 to 4 words/);
      expect(prompt).toMatch(/Never generic/);
      expect(prompt).toMatch(/Unique within the conversation/);
    }
  });

  it.each([
    ["Model router", []],
    ["Furnace tune-up", []],
    ["bb-plugins PR #15", []],
    ["Dentist appointment", []],
    ["Q4 taxes", []],
    ["iOS push relay", []],
    ["Strands phase 1", []],
  ])("%s is a good name", (name, problems) => {
    expect(checkName(name)).toEqual(problems);
  });

  it.each([
    ["Discussion", "generic"],
    ["Follow-up", "generic"],
    ["Question", "generic"],
    ["Follow-up questions", "generic"],
    ["Misc updates", "generic"],
    ["The plan", "generic"],
    ["New task", "generic"],
    ["Can you check the router", "sentence"],
    ["Fix my laptop", "sentence"],
    ["Router is broken.", "sentence"],
    ["What about taxes?", "sentence"],
    ["Model router and the new fallback chain", "too-many-words"],
    ["Supercalifragilisticexpialidocious-configuration", "too-long"],
    ["**Model router**", "markup"],
    ["", "empty"],
  ])("%s is refused (%s)", (name, problem) => {
    expect(checkName(name)).toContain(problem);
  });

  it("is unique within the conversation, ignoring case and punctuation", () => {
    expect(checkName("Model router", ["model-router"])).toEqual(["duplicate"]);
    expect(checkName("Model router", ["Furnace tune-up"])).toEqual([]);
  });

  it("tidies what a model writes around a name", () => {
    expect(tidyName('"Model router".')).toBe("Model router");
    expect(tidyName("Title: **Furnace tune-up**")).toBe("Furnace tune-up");
  });

  it("titles a new strand with the message's first line, cut to 60 characters", () => {
    expect(firstLineTitle("Look at the router\nmore here")).toBe("Look at the router");
    const long = firstLineTitle("Please look into the model router fallback chain because it keeps failing on Sonnet");
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("reading the small model's names", () => {
  it("keeps names that keep the rules, folds a duplicate into the strand that has it, drops the rest", () => {
    const reply = 'Sure: {"n1": {"title": "Furnace tune-up", "summary": "Booking the yearly service."}, "n2": {"title": "Discussion"}, "n3": {"same": "s2"}, "n4": {"title": "model router"}, "r1": {"summary": "Waiting on CI."}}';
    const { answers, summaries } = readNaming(reply, ["n1", "n2", "n3", "n4"], ["Model router"]);
    expect(answers.get("n1")).toEqual({ kind: "name", title: "Furnace tune-up", summary: "Booking the yearly service." });
    expect(answers.has("n2")).toBe(false);
    expect(answers.get("n3")).toEqual({ kind: "same", key: "s2" });
    expect(answers.get("n4")).toEqual({ kind: "same", key: "title:model router" });
    expect(summaries.get("r1")).toBe("Waiting on CI.");
  });

  it("never gives two new strands the same name", () => {
    const { answers } = readNaming('{"n1": {"title": "Model router"}, "n2": {"title": "Model Router"}}', ["n1", "n2"], []);
    expect(answers.get("n1")).toMatchObject({ kind: "name" });
    expect(answers.get("n2")).toEqual({ kind: "same", key: "title:Model Router" });
  });

  it("keeps only good proposed names, at most 12", () => {
    const strands = Array.from({ length: 15 }, (_, index) => ({ title: `Project ${String.fromCharCode(65 + index)}`, summary: "x" }));
    const { strands: kept, tasks } = readProposal(JSON.stringify({ strands: [{ title: "Follow-up" }, ...strands], tasks: { t1: { title: "Router release" }, t2: { title: "Questions" } } }), ["t1", "t2"]);
    expect(kept).toHaveLength(12);
    expect(kept.map((each) => each.title)).not.toContain("Follow-up");
    expect(tasks.get("t1")?.title).toBe("Router release");
    expect(tasks.has("t2")).toBe(false);
  });

  it("uses a task's own title when it keeps the rules", () => {
    expect(taskTitle("Worker: Router release (phase 2)", [])).toEqual({ title: "Router release", named: true });
    expect(taskTitle("Follow up on the thing we discussed yesterday about stuff", []).named).toBe(false);
  });
});
