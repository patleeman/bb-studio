import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  addCommentMark,
  applyEdits,
  commentAnchors,
  mentionsIn,
  readBlocks,
  readMarkdown,
  restoreFromState,
  seedMarkdown,
} from "./doc";
import { shortId } from "./markdown";

function page(markdown: string) {
  const doc = new Y.Doc();
  seedMarkdown(doc, markdown);
  return doc;
}

const ids = (doc: Y.Doc) => readBlocks(doc).map((block) => block.id!);

describe("applyEdits", () => {
  it("inserts, replaces, checks and deletes by short id", () => {
    const doc = page("# Plan\n\n- [ ] Draft\n\nOld text\n");
    const [heading, task, para] = ids(doc);
    const result = applyEdits(
      doc,
      [
        { op: "insert_after", block: shortId(heading!), markdown: "Intro paragraph" },
        { op: "set_checked", block: shortId(task!), checked: true },
        { op: "replace", block: para!, markdown: "New **text**" },
        { op: "append", markdown: "- one\n- two" },
      ],
      "test",
    );
    expect(result.changed).toBe(true);
    expect(result.touched).toContain(para);
    expect(readMarkdown(doc)).toBe("# Plan\n\nIntro paragraph\n\n- [x] Draft\n\nNew **text**\n\n- one\n- two\n");
    expect(ids(doc)[3]).toBe(para);

    applyEdits(doc, [{ op: "delete", block: shortId(heading!) }], "test");
    expect(readMarkdown(doc).startsWith("Intro paragraph")).toBe(true);
  });

  it("replaces text in place and keeps formatting", () => {
    const doc = page("Ship **on Friday** please\n");
    applyEdits(doc, [{ op: "replace_text", find: "Friday", replace: "Monday" }], "test");
    expect(readMarkdown(doc)).toBe("Ship **on Monday** please\n");
  });

  it("rejects unknown, short and ambiguous ids", () => {
    const doc = page("a\n\nb\n");
    expect(() => applyEdits(doc, [{ op: "delete", block: "zzzzzz" }], "t")).toThrow(/No block/);
    expect(() => applyEdits(doc, [{ op: "delete", block: "ab" }], "t")).toThrow(/too short/);
  });

  it("merges with concurrent client edits and keeps comment marks", () => {
    const server = page("# Title\n\nFirst para with comment.\n\nSecond para.\n");
    const [title, first, second] = ids(server);
    addCommentMark(server, first!, "thread-1", "First", "test");

    const client = new Y.Doc();
    Y.applyUpdate(client, Y.encodeStateAsUpdate(server));
    applyEdits(client, [{ op: "replace_text", block: second!, find: "para.", replace: "para (client)." }], "client");

    const before = Y.encodeStateVector(server);
    applyEdits(server, [{ op: "insert_after", block: title!, markdown: "## Agent section\n\n- [ ] Agent task" }], "agent");
    const delta = Y.encodeStateAsUpdate(server, before);
    expect(delta.length).toBeLessThan(Y.encodeStateAsUpdate(server).length);

    Y.applyUpdate(client, delta);
    Y.applyUpdate(server, Y.encodeStateAsUpdate(client));
    const expected =
      "# Title\n\n## Agent section\n\n- [ ] Agent task\n\nFirst para with comment.\n\nSecond para (client).\n";
    expect(readMarkdown(server)).toBe(expected);
    expect(readMarkdown(client)).toBe(expected);
    expect(commentAnchors(client).get("thread-1")).toEqual({ blockId: first, text: "First" });
  });

  it("restores a snapshot as a diff", () => {
    const doc = page("One\n\nTwo\n");
    const snapshot = Y.encodeStateAsUpdate(doc);
    applyEdits(doc, [{ op: "replace_all", markdown: "Changed" }], "t");
    expect(readMarkdown(doc)).toBe("Changed\n");
    restoreFromState(doc, snapshot, "restore");
    expect(readMarkdown(doc)).toBe("One\n\nTwo\n");
  });

  it("finds mentions", () => {
    const doc = page("Ask @[Ops Bot](bot:bot_0123456789abcdef) to check\n");
    expect(mentionsIn(doc)).toMatchObject([{ kind: "bot", target: "bot_0123456789abcdef", label: "Ops Bot" }]);
  });

  it("edits a never-opened empty doc", () => {
    const doc = new Y.Doc();
    applyEdits(doc, [{ op: "append", markdown: "Hello" }], "t");
    expect(readMarkdown(doc)).toBe("Hello\n");
  });
});

describe("comments", async () => {
  const { createThread, listThreads, reply, setResolved } = await import("./comments");
  it("creates, lists, replies to and resolves threads", async () => {
    const doc = page("Budget is 10k for Q3\n");
    const [block] = ids(doc);
    const { threadId, blockId } = await createThread(doc, "bot:bot_1", { block: block!.slice(0, 6), quote: "10k", text: "Is this **final**?" }, "bot:bot_1");
    expect(blockId).toBe(block);
    reply(doc, "user", threadId, "Yes", "user");
    const [thread] = listThreads(doc);
    expect(thread).toMatchObject({ id: threadId, quote: "10k", resolved: false });
    expect(thread!.comments.map((c) => [c.author, c.text])).toEqual([["bot:bot_1", "Is this final?"], ["user", "Yes"]]);
    setResolved(doc, "user", threadId, true, "user");
    expect(listThreads(doc)).toEqual([]);
    await expect(createThread(doc, "bot:bot_1", { block: block!, quote: "missing", text: "x" }, "t")).rejects.toThrow(/not found/);
    expect(listThreads(doc, { includeResolved: true })).toHaveLength(1);
  });
});
