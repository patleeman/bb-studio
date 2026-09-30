import { describe, expect, it } from "vitest";
import { MATCH_LIMIT, RECENT_LIMIT, studioMatches } from "./search";

const item = (id: string, title: string, updatedAt = 0, archived = false) => ({ pluginId: "pages", id, title, updatedAt, archived });

describe("studioMatches", () => {
  const items = [
    item("a", "Launch plan", 1),
    item("b", "Plan the launch", 2),
    item("c", "Explanation notes", 3),
    item("d", "Offline mode", 4),
    item("e", "Old plan", 5, true),
  ];

  it("lists recent items for an empty query, leaving out archived ones", () => {
    expect(studioMatches(items, " ", null).map((match) => match.item.id)).toEqual(["d", "c", "b", "a"]);
    const many = Array.from({ length: 20 }, (_, i) => item(`x${i}`, "x", i));
    expect(studioMatches(many, "", null)).toHaveLength(RECENT_LIMIT);
  });

  it("ranks exact, prefix, word and inner title matches", () => {
    expect(studioMatches(items, "PLAN", null).map((match) => match.item.id)).toEqual(["b", "a", "c"]);
    expect(studioMatches(items, "launch plan", null).map((match) => match.item.id)).toEqual(["a", "b"]);
    expect(studioMatches([item("u", "")], "untitled", null)).toHaveLength(1);
  });

  it("adds content matches after titles, with their snippets", () => {
    const content = { keys: ["pages:d", "pages:a", "pages:e"], snippets: { "pages:d": "…plan offline…", "pages:a": "the plan" } };
    expect(studioMatches(items, "plan", content)).toEqual([
      { item: items[1], snippet: null },
      { item: items[0], snippet: "the plan" },
      { item: items[2], snippet: null },
      { item: items[3], snippet: "…plan offline…" },
    ]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 60 }, (_, i) => item(`x${i}`, "plan", i));
    expect(studioMatches(many, "plan", null)).toHaveLength(MATCH_LIMIT);
  });
});
