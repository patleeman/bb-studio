import { describe, expect, it } from "vitest";
import { speakable } from "./speakable";

describe("speakable", () => {
  it("reduces markdown to words", () => {
    expect(speakable("## Done\n\n- **Two** tests fail in `auth`.\n- See [the log](https://x.y/z).")).toBe("Done\nTwo tests fail in auth.\nSee the log.");
  });

  it("leaves out BB's directives and comments, which are drawn, not read", () => {
    expect(speakable('Done.\n\n::page{id="pg_1"}\n\n::next{reply="👍 Ship it|🧪 Add tests" btw="🐛 I noticed {x}"}')).toBe("Done.");
    expect(speakable("See the card ::design{id=\"dsn_1\"} above.<!-- note -->")).toBe("See the card above.");
  });

  it("leaves code out and keeps plain speech as is", () => {
    expect(speakable("Here it is:\n```ts\nconst a = 1;\n```\nWant more?")).toBe("Here it is:\n (code left out) \nWant more?".replace(/[ \t]+/g, " ").trim());
    expect(speakable("It took about six minutes, and nothing needs you.")).toBe("It took about six minutes, and nothing needs you.");
  });
});
