import { describe, expect, it } from "vitest";
import { dictationParagraphs, pageFieldKey, pageFieldLabel, pageIdFromField, spacedAfter, talkView } from "./talk";

describe("Talk dictation bridge", () => {
  it("round-trips page ids through field keys and ignores other fields", () => {
    expect(pageIdFromField(pageFieldKey("pg_0123456789ab"))).toBe("pg_0123456789ab");
    expect(pageIdFromField("notes:pg_0123456789ab")).toBeNull();
    expect(pageIdFromField("pages:../settings")).toBeNull();
    expect(pageIdFromField(42)).toBeNull();
  });

  it("labels untitled pages", () => {
    expect(pageFieldLabel("  ")).toBe("“Untitled”");
    expect(pageFieldLabel("Launch plan")).toBe("“Launch plan”");
  });

  it("reads Talk's published state for one field", () => {
    const key = pageFieldKey("pg_0123456789ab");
    expect(talkView("", key).mode).toBe("unavailable");
    expect(talkView("idle\n\nidle", key).mode).toBe("idle");
    expect(talkView(`dictating\n${key}\ntranscribing`, key)).toEqual({ mode: "here", phase: "transcribing" });
    expect(talkView("dictating\npages:pg_ffffffffffff\nrecording", key).mode).toBe("elsewhere");
    expect(talkView("busy\n\nrecording", key).mode).toBe("elsewhere");
  });

  it("turns a transcript into paragraphs", () => {
    expect(dictationParagraphs("  First  line\nwraps.\n\n\nSecond one. ")).toEqual(["First line wraps.", "Second one."]);
    expect(dictationParagraphs(" \n ")).toEqual([]);
  });

  it("keeps words apart when inserting after text", () => {
    expect(spacedAfter("", "hi")).toBe("hi");
    expect(spacedAfter("Hello", "there")).toBe(" there");
    expect(spacedAfter("Hello ", "there")).toBe("there");
  });
});
