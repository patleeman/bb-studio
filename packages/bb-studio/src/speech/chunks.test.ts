import { describe, expect, it } from "vitest";
import { speechChunks } from "./chunks";

describe("speechChunks", () => {
  it("keeps short text whole", () => {
    expect(speechChunks("  Done. Two tests fail.  ")).toEqual(["Done. Two tests fail."]);
    expect(speechChunks("   ")).toEqual([]);
  });

  it("cuts at sentence ends, with a short first piece and longer ones after", () => {
    const sentence = "This sentence is about sixty characters long, give or take. ";
    const chunks = speechChunks(sentence.repeat(20));
    expect(chunks[0]!.length).toBeLessThanOrEqual(200);
    expect(chunks.slice(1).every((chunk) => chunk.length <= 600)).toBe(true);
    expect(chunks[1]!.length).toBeGreaterThan(chunks[0]!.length);
    expect(chunks.every((chunk) => chunk.endsWith("take."))).toBe(true);
    expect(chunks.join(" ")).toBe(sentence.repeat(20).trim());
  });

  it("cuts a sentence with no end at commas, then spaces", () => {
    const long = Array.from({ length: 60 }, (_, index) => `item ${index}`).join(", ");
    const chunks = speechChunks(long);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]!.length).toBeLessThanOrEqual(200);
    expect(chunks[0]).toMatch(/,$/);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(long);
  });

  it("treats line breaks as sentence ends", () => {
    expect(speechChunks("First line\nSecond line")).toEqual(["First line Second line"]);
  });
});
