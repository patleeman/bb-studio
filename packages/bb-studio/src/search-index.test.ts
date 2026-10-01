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
      overview: async () => ({ providers: [{ pluginId: "pages" }], items, truncated: new Set() }),
      version: () => 2,
      call: async (_pluginId: string, _method: string, input: { id: string }) => ({ content: content[input.id] }),
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
