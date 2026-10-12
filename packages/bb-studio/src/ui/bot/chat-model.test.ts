import { describe, expect, it } from "vitest";
import { chatEntries, inlineAsk, mergeChain, splitNext, type Row } from "./chat-model";

const day = new Date(2026, 9, 11, 9).getTime();
const user = (id: string, text: string, at = day, extra: Row = {}): Row => ({ kind: "conversation", role: "user", initiator: "user", id, text, createdAt: at, ...extra });
const bot = (id: string, text: string, at = day): Row => ({ kind: "conversation", role: "assistant", id, text, createdAt: at });
const tool = (id: string, toolName: string, extra: Row = {}): Row => ({ kind: "work", workKind: "tool", id, toolName, status: "completed", createdAt: day, ...extra });

describe("chatEntries", () => {
  it("groups messages by sender: the avatar shows on the first of a run", () => {
    const entries = chatEntries([user("u1", "hi"), bot("a1", "Hello"), bot("a2", "How can I help?"), user("u2", "Plan my week")], { now: day });
    expect(entries.map((entry) => entry.kind === "message" ? `${entry.role}:${entry.first}` : entry.kind)).toEqual(["day", "user:true", "assistant:true", "assistant:false", "user:true"]);
  });

  it("adds a day separator when the day changes", () => {
    const yesterday = day - 86_400_000;
    const entries = chatEntries([user("u1", "a", yesterday), user("u2", "b", day)], { now: day });
    expect(entries.filter((entry) => entry.kind === "day").map((entry) => entry.kind === "day" && entry.label)).toEqual(["Yesterday", "Today"]);
    // A new day restarts the run, so the second message is a first again.
    expect(entries.filter((entry) => entry.kind === "message").map((entry) => entry.kind === "message" && entry.first)).toEqual([true, true]);
  });

  it("folds a run of tool steps into one Working line", () => {
    const entries = chatEntries([user("u1", "go"), tool("t1", "pages_read"), tool("t2", "web_search"), tool("t3", "pages_edit", { status: "pending" })], { now: day });
    const work = entries.filter((entry) => entry.kind === "work");
    expect(work).toHaveLength(1);
    expect(work[0]).toMatchObject({ running: true, steps: [{ label: "Used pages read" }, { label: "Used web search" }, { label: "Used pages edit" }] });
  });

  it("marks the last step group running while the Bot works", () => {
    const entries = chatEntries([tool("t1", "pages_read")], { working: true, now: day });
    expect(entries.at(-1)).toMatchObject({ kind: "work", running: true });
  });
});

describe("child-thread cards", () => {
  it("maps a spawn tool to a Started card with the new thread", () => {
    const [, card] = chatEntries([tool("t1", "mcp__bb__thread_spawn", { toolArgs: { title: "Draft the launch post" }, output: "Spawned thr_abc12345" })], { now: day });
    expect(card).toEqual({ kind: "child", id: "t1", threadId: "thr_abc12345", title: "Draft the launch post", status: "running", verb: "started", createdAt: day });
  });

  it("maps `bb thread spawn` commands too", () => {
    const [, card] = chatEntries([{ kind: "work", workKind: "command", id: "c1", command: 'bb thread spawn --title "Fix CI" --prompt go', aggregatedOutput: "thr_zz99xx11", status: "completed", createdAt: day }], { now: day });
    expect(card).toMatchObject({ kind: "child", threadId: "thr_zz99xx11", title: "Fix CI", verb: "started" });
  });

  it("turns child system messages into cards, never raw rows", () => {
    const rows = [
      user("s1", "Thread finished: …", day, { initiator: "system", systemMessageKind: "child-completed", systemMessageSubject: { kind: "thread", threadId: "thr_child001", threadName: "Fix CI" } }),
      user("s2", "Thread failed", day, { initiator: "system", systemMessageKind: "child-failed", systemMessageSubject: { kind: "thread", threadId: "thr_child002", threadName: "Deploy" } }),
      user("s3", "ownership", day, { initiator: "system", systemMessageKind: "ownership-assigned", systemMessageSubject: null }),
    ];
    const entries = chatEntries(rows, { now: day }).filter((entry) => entry.kind !== "day");
    expect(entries).toEqual([
      { kind: "child", id: "s1", threadId: "thr_child001", title: "Fix CI", status: "finished", verb: "update", createdAt: day },
      { kind: "child", id: "s2", threadId: "thr_child002", title: "Deploy", status: "failed", verb: "update", createdAt: day },
    ]);
  });
});

describe("mergeChain", () => {
  it("reads the handoff chain as one conversation, without the handoff requests", () => {
    const rows = mergeChain([
      { threadId: "thr_old", continuation: false, rows: [{ kind: "turn", id: "turn1", children: [user("u1", "hi"), bot("a1", "hello")] }] },
      { threadId: "thr_new", continuation: true, rows: [user("h1", "Continue from thr_old: …"), bot("a2", "Picking up"), user("u2", "thanks")] },
    ]);
    expect(rows.map((row) => row.id)).toEqual(["u1", "a1", "a2", "u2"]);
  });

  it("drops rows repeated across pages", () => {
    const rows = mergeChain([{ threadId: "t", continuation: false, rows: [user("u1", "a"), user("u1", "a")] }]);
    expect(rows).toHaveLength(1);
  });
});

describe("splitNext", () => {
  it("turns a trailing ::next line into chips", () => {
    const { body, next } = splitNext('Done.\n\n::next{reply="👍 Ship it|❓ Why" do="📄 Write it up"}');
    expect(body).toBe("Done.");
    expect(next?.reply.map((item) => item.label)).toEqual(["Ship it", "Why"]);
    expect(next?.do.map((item) => item.label)).toEqual(["Write it up"]);
  });

  it("leaves other text alone", () => {
    expect(splitNext("Just text")).toEqual({ body: "Just text", next: null });
  });
});

describe("inlineAsk", () => {
  const base = { id: "int_1", threadId: "thr_1", status: "pending" };
  it("offers a single-choice question's options inline", () => {
    const ask = inlineAsk({ ...base, payload: { kind: "user_question", questions: [{ id: "q", prompt: "Which day?", multiSelect: false, allowFreeText: true, options: [{ label: "Monday", value: "mon" }] }] } });
    expect(ask).toEqual({ kind: "question", interactionId: "int_1", threadId: "thr_1", questionId: "q", prompt: "Which day?", options: [{ label: "Monday", value: "mon" }], allowFreeText: true });
  });

  it("offers Approve and Deny for an approval", () => {
    const ask = inlineAsk({ ...base, payload: { kind: "approval", availableDecisions: ["allow_once", "allow_for_session", "deny"], reason: null, subject: { kind: "command", command: "rm -rf build" } } });
    expect(ask).toMatchObject({ kind: "approval", title: "Run a command?", detail: "rm -rf build", allowSession: true });
  });

  it("falls back to Open for multi-question forms and other kinds", () => {
    expect(inlineAsk({ ...base, payload: { kind: "user_question", questions: [{ id: "a", prompt: "A", multiSelect: false, allowFreeText: true }, { id: "b", prompt: "B", multiSelect: false, allowFreeText: true }] } })).toMatchObject({ kind: "open", title: "A" });
    expect(inlineAsk({ ...base, payload: { kind: "acme/form", title: "Fill the form", data: null } })).toMatchObject({ kind: "open", title: "Fill the form" });
  });

  it("ignores resolved interactions", () => {
    expect(inlineAsk({ ...base, status: "resolved", payload: { kind: "approval" } })).toBeNull();
  });
});
