import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { CommentStore, describeThread, reviewMessage } from "./comments";
import { MIGRATIONS } from "./store";

function setup() {
  const db = new Database(":memory:");
  for (const migration of MIGRATIONS) db.exec(migration);
  return new CommentStore(db);
}

const shown = (path: string) => path.replace("/repo/", "");
const line = { path: "/repo/src/retry.ts", startLine: 42, endLine: 43, lineText: "for (let i = 0; i < 2; i++) {\n  await send();" };

describe("review comments", () => {
  it("keeps comments pending until they're sent, then lists the open ones for that agent", () => {
    const store = setup();
    const id = store.add("ws", { ...line, body: "Why twice?" });
    store.reply(id, "user", "And no backoff?");
    expect(store.pending("ws").map((each) => each.comment.body)).toEqual(["Why twice?", "And no backoff?"]);
    expect(store.openFor("thr_a")).toEqual([]);

    store.markSent("ws", "thr_a", store.pending("ws"));
    expect(store.pending("ws")).toEqual([]);
    expect(store.openFor("thr_a").map((thread) => thread.id)).toEqual([id]);
    expect(store.openFor("thr_b")).toEqual([]);

    store.reply(id, "agent", "Fixed: one try with backoff.", "thr_a");
    store.resolve(id, true);
    expect(store.openFor("thr_a")).toEqual([]);
    // A new reply reopens it.
    store.reply(id, "user", "Thanks, one more thing");
    expect(store.threads("ws")[0]).toMatchObject({ resolved: false, comments: [{ pending: false }, { pending: false }, { author: "agent", pending: false }, { pending: true }] });
  });

  it("lets the user edit and delete only their unsent comments", () => {
    const store = setup();
    const id = store.add("ws", { ...line, body: "Typo" });
    const reply = store.reply(id, "user", "draft");
    store.edit("ws", reply, "better draft");
    store.delete("ws", reply);
    expect(store.threads("ws")[0]!.comments.map((each) => each.body)).toEqual(["Typo"]);
    store.markSent("ws", "thr_a", store.pending("ws"));
    expect(() => store.edit("ws", id, "changed")).toThrow("haven't been submitted");
    expect(() => store.edit("other", id, "changed")).toThrow("gone");
    // Deleting a thread's first comment takes the thread.
    const other = store.add("ws", { ...line, body: "Drop me" });
    store.reply(other, "user", "and me");
    store.delete("ws", other);
    expect(store.threads("ws").map((thread) => thread.comments[0]!.body)).toEqual(["Typo"]);
  });

  it("writes one message for the review, with each comment's lines and thread id", () => {
    const store = setup();
    const first = store.add("ws", { ...line, body: "Why twice?" });
    store.markSent("ws", "thr_a", store.pending("ws"));
    store.reply(first, "agent", "It retries once on timeout.", "thr_a");
    store.reply(first, "user", "Then name it retryOnce.");
    const second = store.add("ws", { path: "/repo/README.md", startLine: 3, endLine: 3, lineText: "Install with npm", body: "Say pnpm." });
    const message = reviewMessage({ workspace: "Orbit", items: store.pending("ws"), shown });
    expect(message).toContain('Code review from VS Code ("Orbit"): 2 comments.');
    expect(message).toContain(`### 1. src/retry.ts:42–43 (comment thread ${first}), a reply`);
    expect(message).toContain("```ts\nfor (let i = 0; i < 2; i++) {\n  await send();\n```");
    expect(message).toContain("> User: Why twice?\n\n> You: It retries once on timeout.\n\nThen name it retryOnce.");
    expect(message).toContain(`### 2. README.md:3 (comment thread ${second})\n\n\`\`\`md\nInstall with npm\n\`\`\`\n\nSay pnpm.`);
    expect(message).toContain("code_comment_reply");
  });

  it("describes a thread for the agent without the user's unsent replies", () => {
    const store = setup();
    const id = store.add("ws", { ...line, body: "Why twice?" });
    store.markSent("ws", "thr_a", store.pending("ws"));
    store.reply(id, "user", "draft, not sent");
    expect(describeThread(store.threads("ws")[0]!, shown)).toBe(`${id}\tsrc/retry.ts:42–43\n  User: Why twice?`);
  });
});


it("acknowledges only unchanged comments in the delivered snapshot", () => {
  const store = setup();
  const first = store.add("ws", { ...line, body: "first" });
  const changed = store.reply(first, "user", "before");
  const snapshot = store.pending("ws");
  store.edit("ws", changed, "after");
  store.add("ws", { ...line, body: "added during send" });
  store.markSent("ws", "thr_a", snapshot);
  expect(store.pending("ws").map((each) => each.comment.body)).toEqual(["after", "added during send"]);
  expect(store.threads("ws")[0]!.comments[0]!.pending).toBe(false);
});
