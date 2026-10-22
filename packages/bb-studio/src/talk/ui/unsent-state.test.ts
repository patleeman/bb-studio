import { describe, expect, it } from "vitest";
import { unsentAudioState } from "./unsent-state";

describe("unsent audio status", () => {
  it("shows storage failures instead of claiming an empty queue was uploaded", () => {
    expect(unsentAudioState(null, "IndexedDB unavailable")).toBe("error");
    expect(unsentAudioState([], "IndexedDB unavailable")).toBe("error");
  });

  it("distinguishes checking from a successfully read empty queue", () => {
    expect(unsentAudioState(null, null)).toBe("checking");
    expect(unsentAudioState([], null)).toBe("uploaded");
    expect(unsentAudioState([{}], null)).toBe("items");
  });
});
