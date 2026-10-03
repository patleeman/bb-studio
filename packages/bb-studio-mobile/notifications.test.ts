import { describe, expect, it } from "vitest";
import { isQuietCompletion } from "./notifications.js";

describe("quiet completions", () => {
  it.each(["", " \n\t", undefined, "[PASS]", " [pass]\n", "**[PASS]**", "`[Pass]`"])("suppresses %s", (body) => {
    expect(isQuietCompletion({ body, data: { kind: "turn-finished" } })).toBe(true);
  });

  it.each(["All checks PASS", "Tests: [PASS]", "[PASS]\nHere is the report.", "Found a regression.", "Generated image: /tmp/result.png"])(
    "keeps nonempty previews: %s",
    (body) => expect(isQuietCompletion({ body, data: { kind: "turn-finished" } })).toBe(false),
  );

  it.each(["pending-interaction", "thread-error", undefined])("keeps %s alerts even with an empty body", (kind) => {
    expect(isQuietCompletion({ body: "", data: { kind } })).toBe(false);
  });
});
