import { describe, expect, it } from "vitest";
import { FIELD_PENDING_TTL_MS, addPending, parsePending, staleFields, withoutPending } from "./pending-inserts";

describe("pending inserts", () => {
  it("appends a second dictation for the same thread", () => {
    const one = addPending({}, "thr_a", " First thought. ");
    expect(addPending(one, "thr_a", "Second thought.")).toEqual({ thr_a: "First thought. Second thought." });
  });

  it("keeps other threads when one is delivered", () => {
    const pending = addPending(addPending({}, "thr_a", "A"), "thr_b", "B");
    expect(withoutPending(pending, "thr_a")).toEqual({ thr_b: "B" });
  });

  it("drops malformed storage", () => {
    expect(parsePending("not json")).toEqual({});
    expect(parsePending("[1]")).toEqual({});
    expect(parsePending(JSON.stringify({ thr_a: "text", thr_b: 3, thr_c: " " }))).toEqual({ thr_a: "text" });
  });
});

describe("waiting field dictations", () => {
  const now = 10 * FIELD_PENDING_TTL_MS;

  it("starts the wait for a new key and keeps it until the TTL", () => {
    expect(staleFields(["field:a"], {}, now)).toEqual({ stale: [], times: { "field:a": now } });
    expect(staleFields(["field:a"], { "field:a": now - FIELD_PENDING_TTL_MS }, now).stale).toEqual([]);
  });

  it("reports keys past the TTL and forgets delivered ones", () => {
    const result = staleFields(["field:a"], { "field:a": now - FIELD_PENDING_TTL_MS - 1, "field:gone": now }, now);
    expect(result).toEqual({ stale: ["field:a"], times: {} });
  });

  it("treats a time in the future as starting now", () => {
    expect(staleFields(["field:a"], { "field:a": now + 5 }, now).times).toEqual({ "field:a": now });
  });
});
