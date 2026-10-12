import { describe, expect, it } from "vitest";
import { isPassOutput, isSilentOutput, PASS_INSTRUCTION } from "./silent";

describe("isPassOutput", () => {
  it.each(["[PASS]", " [pass]\n", "`[PASS]`", "```\n[PASS]\n```", "**[Pass]**"])("matches %j", (text) => expect(isPassOutput(text)).toBe(true));
  it.each(["", " ", null, undefined, "PASS", "All checks PASS", "Tests: [PASS]", "[PASS]\nHere is the report.", "[PASS] done"])("rejects %j", (text) =>
    expect(isPassOutput(text)).toBe(false));
});

describe("isSilentOutput", () => {
  it("counts empty and [PASS] as silent", () => {
    expect([undefined, null, "", " \n", "[PASS]"].every(isSilentOutput)).toBe(true);
    expect(isSilentOutput("Found a regression.")).toBe(false);
  });
  it("tells agents the exact reply", () => expect(PASS_INSTRUCTION).toBe("If nothing changed, reply exactly [PASS]."));
});
