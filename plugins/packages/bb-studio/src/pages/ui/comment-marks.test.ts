// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BlockNoteEditor } from "@blocknote/core";
import { CommentsExtension, DefaultThreadStoreAuth } from "@blocknote/core/comments";
import { withCollaboration, YjsThreadStore } from "@blocknote/core/yjs";
import { expect, it, vi } from "vitest";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

vi.mock("@get-bb/plugin-sdk/app", () => ({ ThreadTitle: () => null, experimental_Icon: () => null }));

const { addCommentMark, seedMarkdown, textBlocks } = await import("../doc");
const { DOCUMENT_FRAGMENT, THREADS_MAP } = await import("../schema-config");
const { pageSchema } = await import("./blocks");

it("opens a page whose text holds a comment mark and draws the mark as plain text", () => {
  const doc = new Y.Doc();
  seedMarkdown(doc, "First para with comment.\n");
  addCommentMark(doc, textBlocks(doc)[0]!.id, "thread-1", "First", "test");
  const editor = BlockNoteEditor.create(
    withCollaboration({
      schema: pageSchema,
      collaboration: { fragment: doc.getXmlFragment(DOCUMENT_FRAGMENT), user: { name: "You", color: "#2563eb" }, provider: { awareness: new Awareness(doc) } },
      extensions: [
        CommentsExtension({
          threadStore: new YjsThreadStore("user", doc.getMap(THREADS_MAP), new DefaultThreadStoreAuth("user", "editor")),
          resolveUsers: async (ids: string[]) => ids.map((id) => ({ id, username: id, avatarUrl: "" })),
        }),
      ],
    }) as never,
  ) as BlockNoteEditor;
  const element = document.createElement("div");
  document.body.append(element);
  editor.mount(element);
  try {
    expect(element.querySelector(".bn-thread-mark")?.textContent).toBe("First");
    expect(element.textContent).toContain("First para with comment.");
  } finally {
    editor.unmount();
    element.remove();
  }
  expect(readFileSync(join(process.cwd(), "src/pages/ui/PageEditor.tsx"), "utf8")).toContain("CommentsExtension({");
  const css = readFileSync(join(process.cwd(), "src/pages/ui/styles.css"), "utf8");
  expect(css).toMatch(/\.pages-editor \.bn-thread-mark[^{]*\{\s*background: none;/);
});
