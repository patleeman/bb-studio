import { describe, expect, it } from "vitest";
import { isQuietCompletion } from "./notifications.js";
import { isSilentOutput } from "../bb-studio/src/kit/silent";

describe("quiet completions", () => {
  it.each(["", " \n\t", undefined, "[PASS]", " [pass]\n", "**[PASS]**", "`[Pass]`"])("suppresses %s", (body) => {
    expect(isQuietCompletion({ body, data: { kind: "turn-finished" } })).toBe(true);
  });

  it.each(["All checks PASS", "Tests: [PASS]", "[PASS]\nHere is the report.", "Found a regression.", "Generated image: /tmp/result.png"])(
    "keeps nonempty previews: %s",
    (body) => expect(isQuietCompletion({ body, data: { kind: "turn-finished" } })).toBe(false),
  );

  it.each(['::approval{thread="thr_w" id="int_1"}', ' ::approval{thread="thr_w" id="int_1"}\n'])("suppresses a reply that is only an approval card: %s", (body) => {
    expect(isQuietCompletion({ body, data: { kind: "turn-finished" } })).toBe(true);
  });

  it("keeps a reply that says more than the approval card", () => {
    expect(isQuietCompletion({ body: 'Your worker needs you.\n::approval{thread="thr_w" id="int_1"}', data: { kind: "turn-finished" } })).toBe(false);
  });

  it.each(["pending-interaction", "thread-error", undefined])("keeps %s alerts even with an empty body", (kind) => {
    expect(isQuietCompletion({ body: "", data: { kind } })).toBe(false);
  });
});

describe("agrees with Studio's isSilentOutput helper", () => {
  it.each(["", " ", "[PASS]", "`[PASS]`", "```\n[PASS]\n```", "**[pass]**", "PASS", "Tests: [PASS]", "[PASS] done", "Report"])("%j", (body) => {
    expect(isQuietCompletion({ body, data: { kind: "turn-finished" } })).toBe(isSilentOutput(body));
  });
});
