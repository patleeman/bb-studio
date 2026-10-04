import { describe, expect, it } from "vitest";
import { bodyImage, firstLink, lede, plainText, sourceDomains, storyKey, studioRefs } from "./shared";

describe("helpers", () => {
  it("makes story keys", () => {
    expect(storyKey("  Harlem Line / Metro-North!! ")).toBe("harlem-line-metro-north");
    expect(storyKey("!!!")).toBeNull();
  });

  it("makes plain previews", () => {
    expect(plainText("## Hi\n\n- **one** [link](https://a.com)\n```\ncode\n```")).toBe("Hi one link");
    expect(plainText("a".repeat(20), 10)).toBe(`${"a".repeat(9)}…`);
  });

  it("makes ledes from the first paragraph", () => {
    expect(lede("## Today\n\n- Dentist at **3:00 PM**\n- Reply to the landlord\n\nWeather: rain")).toBe("Dentist at 3:00 PM · Reply to the landlord");
    expect(lede("Today:\n- one\n- two")).toBe("Today: one · two");
    expect(lede("![map](https://a.com/m.png)\n\nSee https://x.com/example/status/1 for [the thread](https://x.com/t).")).toBe("See for the thread.");
    expect(lede("```\ncode\n```\n\nAfter")).toBe("After");
  });

  it("finds a post's picture and first link", () => {
    expect(bodyImage("Hi ![a](https://a.com/p.jpg) ![b](https://b.com/q.jpg)")).toBe("https://a.com/p.jpg");
    expect(bodyImage("[a](https://a.com)")).toBeNull();
    expect(firstLink("![a](https://a.com/p.jpg) read [this](https://news.com/story) or https://b.com")).toBe("https://news.com/story");
    expect(firstLink("bare <https://b.com/x> link")).toBe("https://b.com/x");
    expect(firstLink("no links")).toBeNull();
  });

  it("lists link domains once", () => {
    expect(sourceDomains("![p](https://upload.wikimedia.org/p.jpg) [a](https://a.com)")).toEqual(["a.com"]);
    expect(sourceDomains("[a](https://www.nytimes.com/x) [b](https://nytimes.com/y) [c](http://mta.info)")).toEqual(["nytimes.com", "mta.info"]);
  });

  it("finds the Studio items a post links to", () => {
    const body = [
      "Wrote [the plan](http://127.0.0.1:38886/plugins/pages/pages/pg_0123456789ab) and @[Report](item:artifacts:art_1).",
      "Also [same plan](/plugins/pages/pages/pg_0123456789ab), @[Notes](page:pg_aaaaaaaaaaaa), [feed](/plugins/feed/feed/p1) and [web](https://a.com/x).",
    ].join("\n");
    expect(studioRefs(body)).toEqual([{ path: "/plugins/pages/pages/pg_0123456789ab" }, { pluginId: "artifacts", id: "art_1" }, { pluginId: "pages", id: "pg_aaaaaaaaaaaa" }]);
    expect(firstLink(body)).toBe("https://a.com/x");
    expect(sourceDomains(body)).toEqual(["a.com"]);
  });
});
