import { describe, expect, it } from "vitest";
import { agentName, saysName } from "../shared";
import { AddressGate } from "./gate";

describe("saysName", () => {
  it("matches her name as a whole word, possessive and mishearings included", () => {
    expect(saysName("Iris, what's the error rate?", "Iris")).toBe(true);
    expect(saysName("what does iris think", "Iris")).toBe(true);
    expect(saysName("Is that in Iris's notes?", "Iris")).toBe(true);
    expect(saysName("Irish, can you look that up", "Iris")).toBe(true);
    expect(saysName("the irises are blooming", "Iris")).toBe(false);
    expect(saysName("Osiris was a god", "Iris")).toBe(false);
    expect(saysName("Margot, take a note", "Margot")).toBe(true);
    expect(saysName("Margo take a note", "Margot")).toBe(false);
  });

  it("cleans the name setting and falls back to Iris", () => {
    expect(agentName("  Nadia  ")).toBe("Nadia");
    expect(agentName("")).toBe("Iris");
    expect(agentName("<script>")).toBe("script");
    expect(agentName(undefined)).toBe("Iris");
  });
});

describe("AddressGate", () => {
  it("name mode: shut until her name, then open for the follow-up window", () => {
    const gate = new AddressGate("Iris", "name", 25);
    expect(gate.isOpen(100)).toBe(false);
    expect(gate.heard("so the launch is Tuesday", 100)).toBe(false);
    expect(gate.isOpen(100)).toBe(false);
    expect(gate.heard("Iris, when is the launch", 101)).toBe(true);
    expect(gate.why(110)).toBe("name");
    expect(gate.isOpen(125)).toBe(true);
    expect(gate.isOpen(127)).toBe(false);
  });

  it("her own words keep a follow-up going", () => {
    const gate = new AddressGate("Iris", "name", 25);
    gate.heard("Iris?", 0);
    gate.spoke(20);
    expect(gate.why(40)).toBe("follow-up");
    expect(gate.isOpen(46)).toBe(false);
    // Speaking while shut doesn't open it.
    gate.spoke(50);
    expect(gate.isOpen(50)).toBe(false);
  });

  it("judge mode is open unless Quiet; Quiet shuts everything", () => {
    const gate = new AddressGate("Iris", "judge");
    expect(gate.why(0)).toBe("judge");
    gate.setQuiet(true);
    expect(gate.isOpen(0)).toBe(false);
    gate.heard("Iris, are you there", 1);
    gate.ask(1);
    gate.answer(1);
    expect(gate.isOpen(2)).toBe(false);
    gate.setQuiet(false);
    expect(gate.why(3)).toBe("judge");
  });

  it("Ask and an answer arriving open it like her name", () => {
    const gate = new AddressGate("Iris", "name", 25);
    gate.ask(0);
    expect(gate.why(1)).toBe("ask");
    const other = new AddressGate("Iris", "name", 25);
    other.answer(0);
    expect(other.why(1)).toBe("answer");
  });
});
