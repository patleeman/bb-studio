import { describe, expect, it } from "vitest";
import type { Target } from "../contract";
import { pickerChange } from "./RouterSettings";

const gemini: Target = { providerId: "acp-antigravity", model: "gemini-3-pro", reasoningLevel: null, label: "Gemini Pro" };

describe("a chain entry and the model picker", () => {
  it("doesn't rewrite the entry when the picker reports what it shows on opening", () => {
    expect(pickerChange(gemini, { providerId: gemini.providerId, model: gemini.model, reasoningLevel: "medium" })).toBeNull();
    expect(pickerChange({ ...gemini, reasoningLevel: "high" }, { providerId: gemini.providerId, model: gemini.model, reasoningLevel: "high" })).toBeNull();
  });

  it("keeps the label when only the reasoning level changes", () => {
    expect(pickerChange(gemini, { providerId: gemini.providerId, model: gemini.model, reasoningLevel: "high" })).toEqual({ ...gemini, reasoningLevel: "high" });
  });

  it("drops the label for another model, so the new model's name is filled in on save", () => {
    expect(pickerChange(gemini, { providerId: "acp-opencode", model: "zai/glm-5.3", reasoningLevel: "medium" })).toEqual({ providerId: "acp-opencode", model: "zai/glm-5.3", reasoningLevel: "medium" });
  });
});
