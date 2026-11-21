import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
import { PING_MARKER } from "./bot-cache";
import { ConversationText, hasWords, messageText, queryWords, snippetOf, summaryBody, summaryPreview } from "./conversation-text";
import { MIGRATIONS } from "./migrations";

const dbs: Database.Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });

type Event = { seq: number; type: string; data: unknown };
const user = (seq: number, text: string, extra: Record<string, unknown> = {}): Event => ({ seq, type: "client/turn/requested", data: { initiator: "user", input: [{ type: "text", text, ...extra }] } });
const reply = (seq: number, text: string): Event => ({ seq, type: "item/completed", data: { item: { type: "agentMessage", text } } });

/** A store over an in-memory database, and a thread list BB pages 100 events at a time, after a seq. */
function setup(events: Record<string, Event[]>) {
  const db = new Database(":memory:");
  dbs.push(db);
  for (const sql of MIGRATIONS.filter(Boolean)) db.exec(sql);
  const list = vi.fn(async ({ threadId, afterSeq, limit }: { threadId: string; afterSeq?: string; limit?: string }) =>
    (events[threadId] ?? []).filter((event) => event.seq > Number(afterSeq ?? 0)).slice(0, Number(limit ?? 100)));
  const text = new ConversationText({ db, sdk: { threads: { events: { list } } } as never, log: () => {} });
  return { db, text, list };
}

it("keeps what the user wrote and the replies, not Studio's pings, agent-only notes or tool calls", () => {
  expect(messageText(user(1, "Book the lodge for Friday"))).toEqual({ kind: "user", text: "Book the lodge for Friday" });
  expect(messageText(user(2, `${PING_MARKER} keep warm`, { visibility: "agent-only" }))).toBeNull();
  expect(messageText(user(3, "Studio: the user archived this conversation", { visibility: "agent-only" }))).toBeNull();
  expect(messageText(reply(4, "Booked."))).toEqual({ kind: "assistant", text: "Booked." });
  expect(messageText({ seq: 5, type: "item/completed", data: { item: { type: "commandExecution", text: "ls" } } })).toBeNull();
});

it("reads a conversation's events page by page, then only what is new after it goes idle", async () => {
  const many = Array.from({ length: 230 }, (_, at) => reply(at + 1, at === 150 ? "The zebra crossing permit came through" : `Reply ${at + 1}`));
  const { text, list } = setup({ thr_a: many });
  expect(text.pending(["thr_a"])).toBe(true);
  expect(await text.read("thr_a")).toBe(230);
  expect(list).toHaveBeenCalledTimes(3);
  expect(text.pending(["thr_a"])).toBe(false);
  expect(text.search("zebra", [{ threadId: "thr_a", title: "Permits", summary: null }])).toEqual([{ threadId: "thr_a", field: "message", snippet: "The zebra crossing permit came through" }]);
  many.push(reply(231, "A quokka visited"));
  text.touched("thr_a");
  expect(text.pending(["thr_a"])).toBe(true);
  await text.readAll(["thr_a"]);
  expect(list.mock.calls.at(-1)![0]).toMatchObject({ afterSeq: "230" });
  expect(text.search("quokka", [{ threadId: "thr_a", title: "Permits", summary: null }])).toHaveLength(1);
  expect(text.newestReplies(["thr_a"]).get("thr_a")).toBe("A quokka visited");
});

it("finds every word by its start, anywhere in the conversation, and prefers the summary, then a message with all of them, then the title", async () => {
  const { text } = setup({
    trip: [user(1, "Can you find a lodge near the lake?"), reply(2, "Great Wolf Lodge has a room on Friday."), reply(3, "The lodge refund window is 14 days.")],
    tax: [user(1, "What did the assessor say?"), reply(2, "The appeal is due in March.")],
  });
  await text.readAll(["trip", "tax"]);
  const rows = [
    { threadId: "trip", title: "Great Wolf trip", summary: null },
    { threadId: "tax", title: "Tax questions", summary: "Asked about the county assessment." },
  ];
  // Prefixes and case: "lod" finds "lodge"; the newest message wins.
  expect(text.search("LOD", rows)).toEqual([{ threadId: "trip", field: "message", snippet: "The lodge refund window is 14 days." }]);
  expect(text.search("assess", rows)).toEqual([{ threadId: "tax", field: "summary", snippet: "Asked about the county assessment." }]);
  expect(text.search("tax", rows)).toEqual([{ threadId: "tax", field: "title", snippet: null }]);
  // Words spread over the title and a message still match.
  expect(text.search("wolf refund", rows)).toEqual([{ threadId: "trip", field: "message", snippet: "The lodge refund window is 14 days." }]);
  // Every word must be there; a word inside another doesn't count.
  expect(text.search("lodge appeal", rows)).toEqual([]);
  expect(text.search("odge", rows)).toEqual([]);
  // Only the rows asked about.
  expect(text.search("appeal", rows.slice(0, 1))).toEqual([]);
  // Quotes and FTS operators are just words.
  expect(text.search('"lodge" OR NEAR(', rows)).toEqual([]);
  text.forget("trip");
  expect(text.search("lodge", rows)).toEqual([]);
});

it("cuts a long message to one line around the match", () => {
  const long = `${"Earlier context about the weekend plans. ".repeat(6)}Then the zebra crossing permit came through, ${"with more detail after it. ".repeat(6)}`;
  const snippet = snippetOf(long, ["zebra"]);
  expect(snippet.startsWith("…")).toBe(true);
  expect(snippet.endsWith("…")).toBe(true);
  expect(snippet).toContain("zebra crossing permit");
  expect(snippet.length).toBeLessThanOrEqual(162);
  expect(snippetOf("**Bold** and [a link](https://example.com)\n\nsecond line", ["link"])).toBe("Bold and a link second line");
  expect(snippetOf("Deleted the red4/Backups_old folders, _all_ of them; # not a heading", ["backups"])).toBe("Deleted the red4/Backups_old folders, all of them; # not a heading");
  expect(snippetOf("## Heading\n> quoted line", ["quoted"])).toBe("Heading quoted line");
  expect(queryWords("Café  über-cool, café")).toEqual(["cafe", "uber", "cool"]);
  expect(hasWords("The Café opened", ["cafe"])).toBe(true);
});

it("previews a summary with its first line or two, without section heads, quotes or a line that repeats the title", () => {
  expect(summaryPreview("**Decisions**\n- Ship the checklist Friday.\n- The press kit waits.\n\n**Made**\n- The checklist", "Launch prep")).toBe("Ship the checklist Friday. The press kit waits.");
  expect(summaryPreview("**Last replies** (Studio saved these: the conversation ended without writing its summary)\n\n> The cleanup is done.\n> **Removed:**\n> - The meeting agent.", "Cleanup")).toBe("The cleanup is done. The meeting agent.");
  expect(summaryPreview("Tax questions\n\nAsked about the county assessment.", "Tax questions")).toBe("Asked about the county assessment.");
  expect(summaryPreview("", "x")).toBeNull();
  expect(summaryBody("Tax questions\n\nAsked about it.", "Tax questions")).toBe("Asked about it.");
  expect(summaryBody("Only one line", "Only one line")).toBe("Only one line");
});
