import { describe, expect, it } from "vitest";
import { mentionContext, type MentionArtifact } from "./mention";

const base: MentionArtifact = {
  id: "art_0123456789abcdef",
  title: "Q3 [draft]",
  description: "",
  type: "markdown",
  name: "q3.md",
  size: 2048,
  versions: 2,
  updatedAt: Date.UTC(2026, 8, 1),
  text: "# Q3",
};

describe("mentionContext", () => {
  it("describes the artifact, links it and inlines its text", () => {
    const context = mentionContext({ ...base, description: "Numbers for the board" });
    expect(context).toContain(`Studio artifact "Q3 [draft]" (id art_0123456789abcdef): Markdown, q3.md, 2 KB, 2 versions`);
    expect(context).toContain("[Q3 draft](/plugins/artifacts/artifacts/art_0123456789abcdef)");
    expect(context).toContain("Description: Numbers for the board");
    expect(context).toContain("Contents of q3.md:\n\n# Q3");
    expect(context).toContain(`artifactId "art_0123456789abcdef"`);
  });

  it("points to the CLI for long text and for files that aren't text", () => {
    expect(mentionContext({ ...base, text: "x".repeat(70_000) })).toContain("bb artifacts show art_0123456789abcdef");
    const image = mentionContext({ ...base, type: "image", name: "a.png", text: null });
    expect(image).toContain("bb artifacts export art_0123456789abcdef");
    expect(image).not.toContain("Contents of");
  });
});
