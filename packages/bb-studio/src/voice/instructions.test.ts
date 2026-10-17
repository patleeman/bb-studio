import { describe, expect, it } from "vitest";
import { speakable, VOICE_INSTRUCTIONS } from "./instructions";

describe("voice instructions", () => {
  it("fit in BB's 4096 characters", () => {
    expect(VOICE_INSTRUCTIONS.length).toBeLessThan(4096);
  });
});

describe("speakable", () => {
  it("reduces markdown to words", () => {
    expect(speakable("## Done\n\n- **Two** tests fail in `auth`.\n- See [the log](https://x.y/z).")).toBe("Done\nTwo tests fail in auth.\nSee the log.");
  });

  it("leaves code out and keeps plain speech as is", () => {
    expect(speakable("Here it is:\n```ts\nconst a = 1;\n```\nWant more?")).toBe("Here it is:\n (code left out) \nWant more?".replace(/[ \t]+/g, " ").trim());
    expect(speakable("It took about six minutes, and nothing needs you.")).toBe("It took about six minutes, and nothing needs you.");
  });
});
