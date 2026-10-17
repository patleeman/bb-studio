import { describe, expect, it } from "vitest";
import { speakable, VOICE_CHAT_INSTRUCTIONS, VOICE_MODE_INSTRUCTIONS } from "./instructions";

describe("voice instructions", () => {
  it("leave room in BB's 4096 characters for a thread's other instructions", () => {
    expect(VOICE_CHAT_INSTRUCTIONS.length).toBeLessThan(2500);
    expect(VOICE_MODE_INSTRUCTIONS.length).toBeLessThan(2000);
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
