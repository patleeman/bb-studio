import { expect, test } from "vitest";
import { createServerEditor } from "./schema-server";

test("server schema includes custom nodes and the comment mark", () => {
  const editor = createServerEditor();
  for (const name of ["callout", "chart", "stats", "embed", "mention", "checkListItem"]) {
    expect(editor.pmSchema.nodes[name], name).toBeDefined();
  }
  expect(editor.pmSchema.marks.comment).toBeDefined();
});
