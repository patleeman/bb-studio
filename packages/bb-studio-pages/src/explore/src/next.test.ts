import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { MAX_NOTE_LENGTH, NEXT_LIMITS, parseNextItems, preferredReplies } from "./next";
import { INSTRUCTIONS_LIMIT, nextInstructions } from "./prompt";
import { ExploreStore, MIGRATIONS, NEXT_LOG_DAYS } from "./store";
import { appendDraft, pickComposer } from "./ui/composer";

describe("the ::next directive", () => {
  it("parses each group, capped and deduped", () => {
    const items = parseNextItems({
      reply: "👍 Ship it|👍 ship  it|❓ Why",
      btw: "🐛 I noticed retries don't wait. If the server is down, it gets hammered.",
      do: "📄 One|📄 Two|📄 Three|📄 Four",
      other: "🙃 Ignored",
    });
    expect(items.reply.map((item) => item.label)).toEqual(["Ship it", "Why"]);
    expect(items.btw).toEqual([
      {
        emoji: "🐛",
        label: "I noticed retries don't wait. If the server is down, it gets hammered.",
        text: "I noticed retries don't wait. If the server is down, it gets hammered.",
      },
    ]);
    expect(items.do).toHaveLength(NEXT_LIMITS.do);
  });

  it("keeps a note's whole text, and cuts its explainer's label", () => {
    const sentence = `I noticed ${"something long ".repeat(12)}here.`;
    const [note] = parseNextItems({ btw: `🔗 ${sentence}` }).btw;
    expect(note.text).toBe(sentence.replace(/\s+/g, " "));
    expect(note.label.length).toBeLessThanOrEqual(80);
    expect(parseNextItems({ btw: `🔗 ${"word ".repeat(80)}` }).btw[0].text.length).toBeLessThanOrEqual(MAX_NOTE_LENGTH);
    // Without an emoji it gets the default one and keeps all its words.
    expect(parseNextItems({ btw: "I noticed a thing." }).btw[0]).toMatchObject({ emoji: "🔎", text: "I noticed a thing." });
    expect(parseNextItems({ btw: "🐛 One|🐛 one|🏗️ Two|🔗 Three|🕐 Four" }).btw).toHaveLength(NEXT_LIMITS.btw);
  });

  it("shows older explore items as notes", () => {
    const items = parseNextItems({ explore: "🐛 Backoff disagrees — your retry fix depends on it|🕐 Re-entrant lock-free queue" });
    expect(items.btw).toEqual([
      { emoji: "🐛", label: "Backoff disagrees", text: "Backoff disagrees — your retry fix depends on it" },
      { emoji: "🕐", label: "Re-entrant lock-free queue", text: "Re-entrant lock-free queue" },
    ]);
  });

  it("has nothing for missing attributes", () => {
    expect(parseNextItems({})).toEqual({ reply: [], btw: [], do: [] });
  });
});

describe("the Next instructions", () => {
  it("fit, and show a directive that parses", () => {
    const text = nextInstructions({ explore: true, replies: ["👍 Agree", "❓ Clarify"] });
    expect(text.length).toBeLessThan(INSTRUCTIONS_LIMIT);
    const example = /::next\{([^}]+)\}/.exec(text)?.[1] ?? "";
    const attributes = Object.fromEntries([...example.matchAll(/(\w+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
    const items = parseNextItems(attributes);
    expect(items.reply).toHaveLength(2);
    expect(items.btw).toHaveLength(1);
    expect(items.btw[0].text).toMatch(/^I noticed /);
    expect(items.do).toHaveLength(1);
    expect(text).toContain("Prefer these when they fit: 👍 Agree | ❓ Clarify");
    expect(text).toContain("Don't also write ::reactions or ::explore lines");
  });

  it("leave notes out when Explore is off", () => {
    const text = nextInstructions({ explore: false, replies: [] });
    expect(text).not.toContain("btw=");
    expect(text).not.toContain("- btw:");
    expect(text).not.toContain("Prefer these");
  });

  it("read Studio Reactions' saved replies", () => {
    expect(preferredReplies("👍 Agree, 👎 Disagree;✅ Do it\n❓")).toEqual(["👍 Agree", "👎 Disagree", "✅ Do it"]);
    expect(preferredReplies('🙃 say "hi"|bye')).toEqual(["🙃 say hi bye"]);
    expect(preferredReplies("")).toEqual([]);
    expect(preferredReplies(undefined)).toBeNull();
  });
});

describe("the click log", () => {
  function store() {
    let at = 1_000;
    const db = new Database(":memory:");
    for (const statement of MIGRATIONS) db.exec(statement);
    return { store: new ExploreStore(db, () => at), tick: (ms: number) => (at += ms) };
  }

  it("counts each suggestion once as shown, and clicks per kind", () => {
    const { store: log } = store();
    const message = { threadId: "thr_1", messageId: "msg_1" };
    const items = [
      { kind: "reply" as const, emoji: "👍", label: "Ship it" },
      { kind: "do" as const, emoji: "📄", label: "Write it up" },
      { kind: "explore" as const, emoji: "🐛", label: "Backoff" },
    ];
    log.nextShown({ ...message, items });
    log.nextShown({ ...message, items });
    log.nextClicked({ ...message, ...items[1] });
    log.nextClicked({ ...message, ...items[1] });
    // A click on something never logged as shown still counts as shown.
    log.nextClicked({ threadId: "thr_1", messageId: "msg_2", kind: "do", emoji: "📄", label: "write it up" });
    const stats = log.nextStats(0);
    expect(stats.kinds).toEqual([
      { kind: "reply", shown: 1, clicked: 0 },
      { kind: "explore", shown: 1, clicked: 0 },
      { kind: "do", shown: 2, clicked: 2 },
      { kind: "fix", shown: 0, clicked: 0 },
    ]);
    expect(stats.top).toEqual([{ kind: "do", emoji: "📄", label: "Write it up", shown: 2, clicked: 2 }]);
  });

  it("only counts suggestions shown since the given time", () => {
    const { store: log, tick } = store();
    log.nextShown({ threadId: "thr_1", messageId: "msg_1", items: [{ kind: "reply", emoji: "👍", label: "Old" }] });
    const since = tick(1_000);
    log.nextShown({ threadId: "thr_1", messageId: "msg_2", items: [{ kind: "reply", emoji: "👍", label: "New" }] });
    expect(log.nextStats(since).kinds[0]).toEqual({ kind: "reply", shown: 1, clicked: 0 });
  });
});

describe("the click log's size", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const item = (label: string) => [{ kind: "reply" as const, emoji: "👍", label }];

  it("forgets suggestions older than its window", () => {
    let at = 1_000;
    const db = new Database(":memory:");
    for (const statement of MIGRATIONS) db.exec(statement);
    const log = new ExploreStore(db, () => at);
    log.nextShown({ threadId: "thr_1", messageId: "msg_1", items: item("Old") });
    at += (NEXT_LOG_DAYS + 1) * DAY;
    log.nextShown({ threadId: "thr_1", messageId: "msg_2", items: item("New") });
    expect(db.prepare("SELECT label FROM next_suggestions").all()).toEqual([{ label: "New" }]);
    expect(log.nextStats(0).kinds[0]).toEqual({ kind: "reply", shown: 1, clicked: 0 });
  });

  it("keeps at most its row cap, newest first", () => {
    let at = 1_000;
    const db = new Database(":memory:");
    for (const statement of MIGRATIONS) db.exec(statement);
    const log = new ExploreStore(db, () => at, { days: NEXT_LOG_DAYS, maxRows: 2 });
    for (const label of ["a", "b", "c"]) {
      log.nextShown({ threadId: "thr_1", messageId: `msg_${label}`, items: item(label) });
      at += 2 * 60 * 60 * 1000;
    }
    expect(db.prepare("SELECT label FROM next_suggestions ORDER BY shown_at").all()).toEqual([{ label: "b" }, { label: "c" }]);
  });
});

describe("drafting", () => {
  const thread = (threadId: string) => ({ scope: { kind: "thread" as const, threadId } });
  const fresh = { scope: { kind: "new-thread" as const } };

  it("picks the message's thread, then a new thread, never another thread", () => {
    expect(pickComposer([thread("a"), fresh, thread("b")] as never[], "a")).toEqual(thread("a"));
    expect(pickComposer([fresh, thread("b")] as never[], "a")).toEqual(fresh);
    expect(pickComposer([thread("b")] as never[], "a")).toBeNull();
  });

  it("adds the suggestion after the draft", () => {
    expect(appendDraft("", "👍 Ship it")).toBe("👍 Ship it");
    expect(appendDraft("> quote\n", "👍 Ship it")).toBe("> quote\n\n👍 Ship it");
  });
});
