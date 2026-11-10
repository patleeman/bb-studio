import { describe, expect, it } from "vitest";
import {
  formatUnknownModelLabel,
  triggerReasoningLabel,
} from "./unknownModelLabel.fork";

describe("a model id with no catalog entry", () => {
  it.each([
    ["claude-opus-5-5", "Opus 5.5"],
    ["claude-fable-5-2", "Fable 5.2"],
    ["gpt-5-2-codex", "gpt 5.2 Codex"],
    ["o4-mini", "o4 Mini"],
    ["claude", "Claude"],
    ["", ""],
  ])("shows %s as %s", (id, label) => {
    expect(formatUnknownModelLabel(id)).toBe(label);
  });
});

describe("the reasoning half of the model label", () => {
  const base = {
    hasSelectedModel: true,
    modelKnown: true,
    optionLabel: "Medium",
    storedLabel: "Medium",
  };

  it("reads the same on the new-thread page and in a thread whose model the catalog lacks", () => {
    expect(triggerReasoningLabel(base)).toBe("Medium");
    expect(
      triggerReasoningLabel({
        ...base,
        modelKnown: false,
        optionLabel: undefined,
      }),
    ).toBe("Medium");
  });

  it("shows nothing for a known model without that level, or with no model", () => {
    expect(triggerReasoningLabel({ ...base, optionLabel: undefined })).toBe(
      null,
    );
    expect(triggerReasoningLabel({ ...base, hasSelectedModel: false })).toBe(
      null,
    );
  });
});
