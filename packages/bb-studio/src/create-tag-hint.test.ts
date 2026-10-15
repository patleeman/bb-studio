import { describe, expect, it } from "vitest";
import { TAG_DESCRIPTION, tagHint, withTagHint } from "./create-tag-hint";

describe("create tools' tag hint", () => {
  const tool = (name: string, result: unknown) => ({ name, description: "Make a thing.", execute: async () => result });

  it("tells create tools to reuse tags and lists the existing ones after a text result", async () => {
    const wrapped = withTagHint(tool("pages_create", "Created page."), () => ["research", "q4"]);
    expect(wrapped.description).toBe(`Make a thing.${TAG_DESCRIPTION}`);
    expect(await wrapped.execute(undefined as never, undefined as never)).toBe("Created page.\nExisting tags: research, q4.");
  });

  it("leaves other tools, error results and tagless setups alone", async () => {
    const other = tool("pages_read", "text");
    expect(withTagHint(other, () => ["a"])).toBe(other);
    const failed = { content: [{ type: "text", text: "no" }], isError: true };
    expect(await withTagHint(tool("dashboard_create", failed), () => ["a"]).execute(undefined as never, undefined as never)).toBe(failed);
    expect(await withTagHint(tool("design_create", "Created."), () => []).execute(undefined as never, undefined as never)).toBe("Created.");
  });

  it("keeps the list short", () => {
    expect(tagHint(Array.from({ length: 15 }, (_, index) => `t${index}`))).toBe("Existing tags: t0, t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, t11, +3 more.");
  });
});
