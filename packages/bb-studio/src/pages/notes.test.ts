import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS } from "../migrations";
import { TagStore } from "../tags";
import { readMarkdown } from "./doc";
import { draftToMarkdown, NOTES_TAG, noteTitle, Notes } from "./notes";
import { SEND_INLINE_LIMIT } from "./notes-contract";
import { PagesService } from "./service";
import { PageStore } from "./store";

const services: PagesService[] = [];
afterEach(() => {
  for (const service of services.splice(0)) service.hub.disposeAll();
});

// Oct 13 2026, 2:05 PM in UTC.
const AT = Date.UTC(2026, 9, 13, 14, 5);

function setup(db = new Database(":memory:"), migrate = true, threadOverrides?: {
  get?(threadId: string): Promise<{ title?: string | null; projectId?: string | null }>;
  send?(threadId: string, input: { text: string; agentOnly?: boolean }[]): Promise<void>;
}) {
  if (migrate) for (const sql of MIGRATIONS) db.exec(sql);
  const store = new PageStore(db);
  const events: unknown[] = [];
  const service = new PagesService({ realtime: { publish: (_channel: string, event: unknown) => events.push(event) } } as never, store);
  services.push(service);
  const tags = new TagStore(db);
  const sent: { threadId: string; input: { text: string; agentOnly?: boolean }[] }[] = [];
  const links: [string, string, string][] = [];
  const published: [string, string][] = [];
  const notes = new Notes({
    db,
    service,
    tags,
    threads: {
      get: (threadId) => threadOverrides?.get?.(threadId) ?? (threadId === "thr_gone" ? Promise.reject(new Error("Thread not found")) : Promise.resolve({ title: "Weekly sync", projectId: "proj_a" })),
      send: async (threadId, input) => { sent.push({ threadId, input }); await threadOverrides?.send?.(threadId, input); },
    },
    linkThread: (pageId, threadId, state) => links.push([pageId, threadId, state]),
    publish: (pageId, threadId) => published.push([pageId, threadId]),
    now: () => AT,
  });
  return { db, store, service, tags, notes, sent, links, published, events };
}

describe("noteTitle", () => {
  it("names the time and the thread", () => {
    expect(noteTitle(new Date(AT), "Weekly sync", "UTC")).toBe("Notes · Oct 13, 2:05 PM · Weekly sync");
    expect(noteTitle(new Date(AT), "Weekly sync", "America/New_York")).toBe("Notes · Oct 13, 10:05 AM · Weekly sync");
  });

  it("leaves out a missing thread title, shortens a long one and ignores a bad time zone", () => {
    expect(noteTitle(new Date(AT), "  ", "UTC")).toBe("Notes · Oct 13, 2:05 PM");
    expect(noteTitle(new Date(AT), null, "UTC")).toBe("Notes · Oct 13, 2:05 PM");
    const long = noteTitle(new Date(AT), "x".repeat(200), "UTC");
    expect(long.length).toBeLessThan(90);
    expect(long.endsWith("…")).toBe(true);
    expect(() => noteTitle(new Date(AT), "Sync", "Not/AZone")).not.toThrow();
  });
});

describe("draftToMarkdown", () => {
  it("keeps each typed line as its own paragraph and lists together", () => {
    expect(draftToMarkdown("Attendees: Ana, Bo\nDecisions\n- ship Friday\n- move standup\nNext")).toBe(
      "Attendees: Ana, Bo\n\nDecisions\n\n- ship Friday\n- move standup\n\nNext\n",
    );
  });

  it("keeps fenced code as typed and collapses blank lines", () => {
    expect(draftToMarkdown("a\n\n\n```\nx\n\ny\n```\nb")).toBe("a\n\n```\nx\n\ny\n```\n\nb\n");
    expect(draftToMarkdown("  \n ")).toBe("");
  });
});

describe("Notes", () => {
  it("serializes concurrent creation and appends every draft to the winning note", async () => {
    const { notes, service, store } = setup();
    const [first, second] = await Promise.all([
      notes.create({ threadId: "thr_race", text: "First draft", timeZone: "UTC" }),
      notes.create({ threadId: "thr_race", text: "Second draft", timeZone: "UTC" }),
    ]);

    expect(first.appended).toBe(false);
    expect(second.appended).toBe(true);
    expect(second.note.pageId).toBe(first.note.pageId);
    expect(readMarkdown(service.hub.open(first.note.pageId).doc)).toBe("First draft\n\nSecond draft\n");
    expect(store.list()).toHaveLength(1);
  });

  it("makes a page from the draft, titled, tagged Notes and linked to the thread", async () => {
    const { notes, store, service, tags, links, published } = setup();
    const { note, appended } = await notes.create({ threadId: "thr_1", text: "Ana: ship Friday\n- check CI", timeZone: "UTC" });

    expect(appended).toBe(false);
    expect(note).toMatchObject({ threadId: "thr_1", state: "open", title: "Notes · Oct 13, 2:05 PM · Weekly sync", href: `/plugins/studio/studio/pages/${note.pageId}` });
    const meta = store.meta(note.pageId)!;
    expect(meta).toMatchObject({ project_id: "proj_a", icon: "📝", title: note.title });
    expect(readMarkdown(service.hub.open(note.pageId).doc)).toBe("Ana: ship Friday\n\n- check CI\n");
    // Saved to BB as it's made, not on the next autosave.
    expect(store.get(note.pageId)!.markdown).toBe("Ana: ship Friday\n\n- check CI\n");

    const notesTag = tags.byName(NOTES_TAG)!;
    expect(tags.assignments().get(`pages:${note.pageId}`)).toEqual([notesTag.id]);
    expect(links).toEqual([[note.pageId, "thr_1", "open"]]);
    expect(published).toContainEqual([note.pageId, "thr_1"]);
    expect(notes.forThread("thr_1")).toMatchObject({ pageId: note.pageId });
    expect(notes.forPage(note.pageId)).toMatchObject({ threadId: "thr_1" });
    expect(notes.forThread("thr_other")).toBeNull();
  });

  it("adds a second expand to the open note instead of making another", async () => {
    const { notes, service, store } = setup();
    const first = await notes.create({ threadId: "thr_1", text: "First", timeZone: "UTC" });
    const second = await notes.create({ threadId: "thr_1", text: "Second", timeZone: "UTC" });
    expect(second.appended).toBe(true);
    expect(second.note.pageId).toBe(first.note.pageId);
    expect(readMarkdown(service.hub.open(first.note.pageId).doc)).toBe("First\n\nSecond\n");
    expect(store.list().length).toBe(1);
    // An empty draft just finds the note.
    expect((await notes.create({ threadId: "thr_1", text: "  ", timeZone: "UTC" })).note.pageId).toBe(first.note.pageId);
  });

  it("fails without a page when the thread can't be read", async () => {
    const { notes, store } = setup();
    await expect(notes.create({ threadId: "thr_gone", text: "x" })).rejects.toThrow("Thread not found");
    expect(store.list()).toEqual([]);
  });

  it("finds the open note again after a reload, with what was typed in it", async () => {
    const db = new Database(":memory:");
    const before = setup(db);
    const { note } = await before.notes.create({ threadId: "thr_1", text: "Draft", timeZone: "UTC" });
    // Typing in the page: the editor's edits reach the hub, which saves them.
    before.service.edit(note.pageId, [{ op: "append", markdown: "Typed in the page" }], { key: "user", name: "You", color: "#000" });
    before.service.hub.flushAll();
    before.service.hub.disposeAll();

    const after = setup(db, false);
    const found = after.notes.forThread("thr_1");
    expect(found).toMatchObject({ pageId: note.pageId, state: "open", title: note.title });
    expect(readMarkdown(after.service.hub.open(note.pageId).doc)).toBe("Draft\n\nTyped in the page\n");
  });

  it("sends a short note as the message, then it's an ordinary page in Notes", async () => {
    const { notes, sent, tags, links } = setup();
    const { note } = await notes.create({ threadId: "thr_1", text: "- ship Friday", timeZone: "UTC" });
    const result = await notes.send(note.pageId);
    expect(result.sent).toBe("content");
    expect(sent).toEqual([{ threadId: "thr_1", input: [{ text: "- ship Friday" }] }]);
    expect(result.note.state).toBe("sent");
    expect(notes.forThread("thr_1")).toBeNull();
    expect(notes.forPage(note.pageId)).toMatchObject({ state: "sent" });
    expect(tags.assignments().get(`pages:${note.pageId}`)).toHaveLength(1);
    expect(links.at(-1)).toEqual([note.pageId, "thr_1", "sent"]);
    await expect(notes.send(note.pageId)).rejects.toThrow("already sent");
  });

  it("shares an in-flight send and refuses keep or discard until it settles", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const { notes, sent } = setup(new Database(":memory:"), true, { send: async () => blocked });
    const { note } = await notes.create({ threadId: "thr_1", text: "Send once", timeZone: "UTC" });
    const first = notes.send(note.pageId);
    const second = notes.send(note.pageId);
    await Promise.resolve();

    expect(sent).toHaveLength(1);
    expect(() => notes.keep(note.pageId, "Saved")).toThrow("being sent");
    expect(() => notes.discard(note.pageId)).toThrow("being sent");
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(sent).toHaveLength(1);
    expect(a.note.state).toBe("sent");
  });

  it("sends a long note as a link and a request to summarize", async () => {
    const { notes, sent } = setup();
    const long = Array.from({ length: 200 }, (_, i) => `Point ${i} ${"x".repeat(50)}`).join("\n");
    const { note } = await notes.create({ threadId: "thr_1", text: long, timeZone: "UTC" });
    expect(note.length).toBeGreaterThan(SEND_INLINE_LIMIT);
    const result = await notes.send(note.pageId, "auto");
    expect(result.sent).toBe("summarize");
    const [message] = sent;
    expect(message!.input[0]!.text).toBe(`Summarize these notes: [${note.title}](/plugins/studio/studio/pages/${note.pageId})`);
    expect(message!.input[1]).toMatchObject({ agentOnly: true });
    expect(message!.input[1]!.text).toContain("Point 199");
  });

  it("sends the mode asked for, and refuses an empty note", async () => {
    const { notes, sent } = setup();
    const { note } = await notes.create({ threadId: "thr_1", text: "Short", timeZone: "UTC" });
    expect((await notes.send(note.pageId, "summarize")).sent).toBe("summarize");
    expect(sent[0]!.input[0]!.text).toMatch(/^Summarize these notes: /);
    const empty = await notes.create({ threadId: "thr_2", text: "", timeZone: "UTC" });
    await expect(notes.send(empty.note.pageId)).rejects.toThrow("The note is empty");
    expect(notes.forThread("thr_2")).not.toBeNull();
  });

  it("keeps a note with a new title, still in Notes", async () => {
    const { notes, store, tags } = setup();
    const { note } = await notes.create({ threadId: "thr_1", text: "Notes", timeZone: "UTC" });
    const kept = notes.keep(note.pageId, "  Q4 planning  ");
    expect(kept).toMatchObject({ state: "kept", title: "Q4 planning" });
    expect(store.meta(note.pageId)!.title).toBe("Q4 planning");
    expect(notes.forThread("thr_1")).toBeNull();
    expect(tags.assignments().get(`pages:${note.pageId}`)).toEqual([tags.byName(NOTES_TAG)!.id]);
    expect(() => notes.discard(note.pageId)).toThrow("already kept");
  });

  it("discards a note: the page, its tag and its link go", async () => {
    const { notes, store, tags, events } = setup();
    const { note } = await notes.create({ threadId: "thr_1", text: "Scratch", timeZone: "UTC" });
    expect(notes.discard(note.pageId)).toBe(true);
    expect(store.meta(note.pageId)).toBeNull();
    expect(tags.assignments().get(`pages:${note.pageId}`)).toBeUndefined();
    expect(notes.forThread("thr_1")).toBeNull();
    expect(notes.forPage(note.pageId)).toBeNull();
    expect(events).toContainEqual({ type: "deleted", pageIds: [note.pageId] });
    expect(() => notes.discard(note.pageId)).toThrow("no longer exists");
  });

  it("forgets a note whose page was deleted elsewhere", async () => {
    const { notes, service } = setup();
    const { note } = await notes.create({ threadId: "thr_1", text: "x", timeZone: "UTC" });
    service.deletePage(note.pageId);
    expect(notes.forThread("thr_1")).toBeNull();
    // A new expand starts a new note.
    const next = await notes.create({ threadId: "thr_1", text: "y", timeZone: "UTC" });
    expect(next.appended).toBe(false);
  });

  it("deletes note and checklist ownership rows for every page in a deleted tree", () => {
    const { db, service } = setup();
    const parent = service.createPage({ projectId: "proj_a", parentId: null, title: "Parent", actor: "user" });
    const child = service.createPage({ projectId: "proj_a", parentId: parent.id, title: "Child", actor: "user" });
    const note = db.prepare("INSERT INTO page_notes (page_id, thread_id, state, created_at) VALUES (?, ?, 'open', ?)");
    note.run(parent.id, "thr_parent", AT);
    note.run(child.id, "thr_child", AT);
    const handoff = db.prepare("INSERT INTO checklist_handoffs (thread_id, page_id, block_id, title, state, created_at, updated_at) VALUES (?, ?, 'block', 'Task', 'working', ?, ?)");
    handoff.run("thr_parent", parent.id, AT, AT);
    handoff.run("thr_child", child.id, AT, AT);

    service.deletePage(parent.id);

    expect(db.prepare("SELECT page_id FROM page_notes").all()).toEqual([]);
    expect(db.prepare("SELECT page_id FROM checklist_handoffs").all()).toEqual([]);
  });

  it("keeps the newest open note when applying the unique-thread migration", () => {
    const db = new Database(":memory:");
    for (const sql of MIGRATIONS.slice(0, -1)) db.exec(sql);
    const insert = db.prepare("INSERT INTO page_notes (page_id, thread_id, state, created_at) VALUES (?, 'thr_dupe', 'open', ?)");
    insert.run("pg_old", 1);
    insert.run("pg_a", 3);
    insert.run("pg_z", 3);

    db.exec(MIGRATIONS.at(-1)!);

    expect(db.prepare("SELECT page_id, state FROM page_notes WHERE thread_id = 'thr_dupe' ORDER BY page_id").all()).toEqual([
      { page_id: "pg_a", state: "kept" },
      { page_id: "pg_old", state: "kept" },
      { page_id: "pg_z", state: "open" },
    ]);
    expect(() => insert.run("pg_extra", 4)).toThrow(/UNIQUE constraint failed/);
  });
});
