import { expect, it } from "vitest";
import { REASONING_LEVELS, toReasoningLevel, toReasoningLevelOrNull } from "./reasoning";

it("keeps BB's ladder and maps other names onto it", () => {
  for (const level of REASONING_LEVELS) expect(toReasoningLevel(level)).toBe(level);
  expect(toReasoningLevel("High")).toBe("high");
  expect(toReasoningLevel("minimal")).toBe("low");
  expect(toReasoningLevel("extra_high")).toBe("xhigh");
  expect(toReasoningLevel("turbo")).toBe("medium");
  expect(toReasoningLevel("turbo", "low")).toBe("low");
  expect(toReasoningLevel(undefined, "none")).toBe("none");
  expect(toReasoningLevelOrNull(null)).toBeNull();
  expect(toReasoningLevelOrNull("max")).toBe("max");
});
