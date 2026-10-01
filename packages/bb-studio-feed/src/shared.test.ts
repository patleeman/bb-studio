import { describe, expect, it } from "vitest";
import { parsePost, plainText, sourceDomains, storyKey } from "./shared";

describe("parsePost", () => {
  it("reads the post line that ends a reply", () => {
    const post = parsePost('Service is back on the Harlem Line.\n\n::post{title="Harlem Line delays cleared" topic="Commute" story="Harlem Line"}');
    expect(post).toEqual({
      title: "Harlem Line delays cleared",
      topic: "Commute",
      story: "harlem-line",
      priority: "normal",
      body: "Service is back on the Harlem Line.",
      source: '::post{title="Harlem Line delays cleared" topic="Commute" story="Harlem Line"}',
    });
  });

  it("allows other directive lines after it", () => {
    const post = parsePost('Body\n::post{title="T" priority="URGENT"}\n::explore{items="🐛 A"}\n\n::reactions{items="👍 Ok"}\n');
    expect(post?.priority).toBe("urgent");
    expect(post?.body).toBe("Body");
  });

  it("ignores a post line that isn't at the end", () => {
    expect(parsePost('::post{title="T"}\n\nThen more text.')).toBeNull();
  });

  it("ignores a post line inside a code block", () => {
    expect(parsePost('Example:\n```\n::post{title="T"}\n```')).toBeNull();
  });

  it("needs a title", () => {
    expect(parsePost('Body\n::post{topic="News"}')).toBeNull();
    expect(parsePost('Body\n::post{title="  "}')).toBeNull();
  });

  it("takes the last post line when there are two", () => {
    expect(parsePost('Body\n::post{title="First"}\n::post{title="Second"}')?.title).toBe("Second");
  });

  it("allows an empty body", () => {
    expect(parsePost('::post{title="Only a title"}')?.body).toBe("");
  });

  it("is null for ordinary replies", () => {
    expect(parsePost("Just an answer.")).toBeNull();
    expect(parsePost(null)).toBeNull();
  });
});

describe("helpers", () => {
  it("makes story keys", () => {
    expect(storyKey("  Harlem Line / Metro-North!! ")).toBe("harlem-line-metro-north");
    expect(storyKey("!!!")).toBeNull();
  });

  it("makes plain previews", () => {
    expect(plainText("## Hi\n\n- **one** [link](https://a.com)\n```\ncode\n```")).toBe("Hi one link");
    expect(plainText("a".repeat(20), 10)).toBe(`${"a".repeat(9)}…`);
  });

  it("lists link domains once", () => {
    expect(sourceDomains("[a](https://www.nytimes.com/x) [b](https://nytimes.com/y) [c](http://mta.info)")).toEqual(["nytimes.com", "mta.info"]);
  });
});
