import { describe, expect, it } from "vitest";
import { isQuietCompletion } from "./notifications.js";

describe("quiet completions", () => {
  it.each(["[PASS]", " [pass]\n", "**[PASS]**", "`[Pass]`", "~~[PASS]~~"])("suppresses %s", (body) => {
    expect(isQuietCompletion({ body, data: { kind: "turn-finished" } })).toBe(true);
  });

  it.each(["All checks PASS", "Tests: [PASS]", "[PASS]\nHere is the report.", "Found a regression.\n[PASS]", "", undefined])(
    "keeps useful or missing previews: %s",
    (body) => expect(isQuietCompletion({ body, data: { kind: "turn-finished" } })).toBe(false),
  );

  it.each(["pending-interaction", "thread-error", undefined])("keeps %s alerts even with a PASS body", (kind) => {
    expect(isQuietCompletion({ body: "[PASS]", data: { kind } })).toBe(false);
  });
});
