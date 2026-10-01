import { describe, expect, it } from "vitest";
import { copyTitle, fillTemplate, fillTemplateJson } from "./template";

describe("templates", () => {
  it("replaces exact named variables and preserves unknown placeholders", () => {
    expect(fillTemplate("{{name}} {{name}} {{later}} {{bad-name}}", { name: "Launch" })).toBe("Launch Launch {{later}} {{bad-name}}");
  });
  it("names a copy of an untitled item", () => {
    expect(copyTitle("  ")).toBe("Untitled (copy)");
  });
  it("escapes variable values in JSON drawings", () => {
    expect(JSON.parse(fillTemplateJson('{"text":"{{name}}"}', { name: 'A "quote"' }))).toEqual({ text: 'A "quote"' });
  });
});
