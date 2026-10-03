import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "./migrations";
import { SearchIndex, excerpt, tokens } from "./search-index";
import type { StudioHub, HubItem } from "./hub";

const item = (id: string, title: string, updatedAt = 1): HubItem => ({
  pluginId: "pages", id, kind: "page", title, updatedAt, createdAt: 1, projectId: "one", href: `/pages/${id}`,
  icon: null, parentId: null, updatedBy: null, preview: null, facts: [], badge: null, thumbnailUrl: null, archived: false,
});

describe("Studio search index", () => {
  it("tokenizes punctuation and excerpts match ranges", () => {
    expect(tokens("  Café—offline.sync! ")).toEqual(["café", "offline", "sync"]);
    expect(tokens("!!!")).toEqual([]);
    expect(excerpt("Ship offline sync this week", ["offline", "sync"])).toEqual({ text: "Ship offline sync this week", ranges: [{ start: 5, end: 12 }, { start: 13, end: 17 }] });
  });

  it("ranks title matches, filters, and applies incremental changes", async () => {
    const db = new Database(":memory:");
    for (const sql of MIGRATIONS) db.exec(sql);
    let items = [item("a", "Offline sync", 2), item("b", "Notes", 3)];
    const content: Record<string, string> = { a: "The launch plan", b: "Discuss offline sync tomorrow" };
    const hub = {
      overview: async () => ({ providers: [{ pluginId: "pages", state: "ready" }], items, truncated: new Set() }),
      providers: async () => [{ pluginId: "pages", state: "ready" }],
      version: () => 2,
      call: async (_pluginId: string, method: string, input: { id: string; ids: string[] }) => method === "studio_get" ? { items: items.filter((entry) => input.ids.includes(entry.id)) } : ({ content: content[input.id] }),
      get: async (_pluginId: string, ids: string[]) => items.filter((entry) => ids.includes(entry.id)),
    } as unknown as StudioHub;
    const index = new SearchIndex(db, hub);
    await index.ensure();
    expect(index.search("offline sync").map((hit) => hit.ref.id)).toEqual(["a", "b"]);
    expect(index.search("offline", { projectId: "other" })).toEqual([]);
    items = [item("b", "Notes", 3), item("c", "Roadmap", 4)];
    content.c = "Ship offline sync next";
    await index.changed("pages", ["c"], ["a"]);
    expect(index.search("offline sync").map((hit) => hit.ref.id)).toEqual(["c", "b"]);
    content.b = "Only shipping notes remain";
    await index.changed("pages", ["b"]);
    expect(index.search("offline sync").map((hit) => hit.ref.id)).toEqual(["c"]);
    expect(index.recent(12, { skip: ["pages:page"] })).toEqual([]);
    expect(index.recent(12, { skip: ["talk:page"] }).map((hit) => hit.ref.id)).toEqual(["c", "b"]);
    db.close();
  });
});

function fixture() {
  const db = new Database(":memory:");
  for (const sql of MIGRATIONS) db.exec(sql);
  const state = { items: [item("a", "First")], online: true, truncated: false, failRead: false };
  const hub = {
    providers: async () => [{ pluginId: "pages", state: state.online ? "ready" : "offline" }],
    overview: async () => ({ providers: await hub.providers(), items: state.online ? [...state.items] : [], truncated: new Set(state.truncated ? ["pages"] : []) }),
    version: () => 2,
    call: async (_pluginId: string, method: string, input: { id: string; ids: string[] }) => {
      if (!state.online || (method === "studio_read" && state.failRead)) throw new Error("Unavailable");
      return method === "studio_get" ? { items: state.items.filter((entry) => input.ids.includes(entry.id)) } : { content: "searchable body" };
    },
    get: async (_pluginId: string, ids: string[]) => state.online ? state.items.filter((entry) => ids.includes(entry.id)) : [],
  };
  return { db, state, hub, index: new SearchIndex(db, hub as unknown as StudioHub) };
}

it.each(["ensure", "rebuild"] as const)("replays edits, creations and deletions during initial %s", async (start) => {
  const { db, state, hub, index } = fixture();
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const reading = new Promise<void>((resolve) => { started = resolve; });
  const original = hub.call;
  let first = true;
  hub.call = async (...args) => {
    if (args[1] === "studio_read" && first) { first = false; started(); await waiting; }
    return original(...args);
  };
  state.items.push(item("b", "Before edit"));
  const building = index[start]();
  await reading;
  state.items = [item("b", "After edit"), item("c", "Created during indexing")];
  const changed = index.changed("pages", ["b", "c"], ["a"]);
  release();
  await Promise.all([building, changed]);
  expect(index.search("First")).toEqual([]);
  expect(index.search("After").map((hit) => hit.ref.id)).toEqual(["b"]);
  expect(index.search("Created").map((hit) => hit.ref.id)).toEqual(["c"]);
  db.close();
});

it("preserves unavailable providers and reconciles them after recovery", async () => {
  const { db, state, index } = fixture();
  await index.ensure();
  state.online = false;
  await index.changed("talk");
  expect(index.search("searchable").map((hit) => hit.ref.id)).toEqual(["a"]);
  await index.changed("pages", ["a"]);
  expect(index.search("searchable").map((hit) => hit.ref.id)).toEqual(["a"]);
  state.items = [item("b", "Recovered")];
  state.online = true;
  await index.ensure();
  expect(index.search("searchable").map((hit) => hit.ref.id)).toEqual(["b"]);
  db.close();
});

it("keeps unlisted rows from truncated providers until a complete reconciliation", async () => {
  const { db, state, index } = fixture();
  state.items.push(item("b", "Second"));
  await index.ensure();
  state.items = [item("b", "Second")];
  state.truncated = true;
  await index.rebuild();
  expect(index.search("First").map((hit) => hit.ref.id)).toEqual(["a"]);
  state.truncated = false;
  await index.ensure();
  expect(index.search("First")).toEqual([]);
  db.close();
});

it("preserves indexed text on failed reads and retries without another change event", async () => {
  const { db, state, index } = fixture();
  await index.ensure();
  state.failRead = true;
  state.items = [item("a", "New title")];
  await index.changed("pages", ["a"]);
  expect(index.search("searchable").map((hit) => hit.ref.id)).toEqual(["a"]);
  state.failRead = false;
  await index.ensure();
  expect(index.search("New title").map((hit) => hit.ref.id)).toEqual(["a"]);
  db.close();
});
