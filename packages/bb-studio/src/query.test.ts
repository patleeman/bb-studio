import { describe, expect, it } from "vitest";
import { compileQuery, describeFilter, facetCounts, formatQuery, parseQuery, suggest, toggleFilter, type QueryVocabulary } from "./query";

const vocabulary: QueryVocabulary = {
  kinds: [
    { id: "page", label: "Page", plural: "Pages" },
    { id: "dictation", label: "Dictation", plural: "Dictations", background: true },
  ],
  projects: [{ id: "proj_a", name: "bb-studio" }, { id: "proj_b", name: "Q4 launch" }],
  tags: [{ id: "tag_x", name: "Explore" }],
  spaces: [{ id: "spc_1", name: "Launch" }],
};

const page = { kind: "page", projectId: "proj_a", archived: false, tags: ["tag_x"], spaces: ["spc_1"] };
const global = { kind: "page", projectId: null, archived: false };
const old = { kind: "page", projectId: "proj_b", archived: true };
const dictation = { kind: "dictation", projectId: null, archived: false };

describe("query", () => {
  it("parses filters, exclusions, quotes and words", () => {
    expect(parseQuery('kind:page -tag:Explore project:"Q4 launch" release notes "exact phrase" foo:bar')).toEqual({
      filters: [
        { field: "kind", value: "page" },
        { field: "tag", value: "Explore", negate: true },
        { field: "project", value: "Q4 launch" },
      ],
      text: "release notes exact phrase foo:bar",
    });
    expect(parseQuery("kind: ").filters).toEqual([]);
  });

  it("formats back to the same query", () => {
    const text = 'kind:page -tag:Explore project:"Q4 launch" notes';
    expect(formatQuery(parseQuery(text))).toBe(text);
  });

  it("matches any value of a field and every field", () => {
    const query = compileQuery(parseQuery("project:bb-studio project:global kind:Pages"), vocabulary);
    expect([page, global, old].map((item) => query.test(item))).toEqual([true, true, false]);
    expect(compileQuery(parseQuery("-tag:explore"), vocabulary).test(page)).toBe(false);
    expect(compileQuery(parseQuery("tag:none"), vocabulary).test(global)).toBe(true);
    expect(compileQuery(parseQuery("space:launch"), vocabulary).test(global)).toBe(false);
  });

  it("shows archived items only when asked", () => {
    expect(compileQuery(parseQuery(""), vocabulary).test(old)).toBe(false);
    expect(compileQuery(parseQuery("is:archived"), vocabulary).test(old)).toBe(true);
    expect(compileQuery(parseQuery("is:archived"), vocabulary).test(page)).toBe(false);
  });

  it("hides background kinds unless asked for or searched", () => {
    expect(compileQuery(parseQuery(""), vocabulary).test(dictation)).toBe(false);
    expect(compileQuery(parseQuery("kind:dictation"), vocabulary).test(dictation)).toBe(true);
    expect(compileQuery(parseQuery("words"), vocabulary).test(dictation)).toBe(true);
  });

  it("matches nothing for a value that names nothing", () => {
    const query = compileQuery(parseQuery("tag:missing"), vocabulary);
    expect(query.unknown).toEqual([{ field: "tag", value: "missing" }]);
    expect(query.test(page)).toBe(false);
    expect(compileQuery(parseQuery("-tag:missing"), vocabulary).test(page)).toBe(true);
  });

  it("counts each field's values without its own filters", () => {
    const counts = facetCounts([page, global, old, dictation], compileQuery(parseQuery("kind:page project:bb-studio"), vocabulary));
    expect(counts.kind).toEqual(new Map([["page", 1]]));
    expect(counts.project).toEqual(new Map([["proj_a", 1], ["", 1]]));
    expect(counts.archived).toBe(0);
    expect(facetCounts([page, global, old], compileQuery(parseQuery(""), vocabulary)).archived).toBe(1);
  });

  it("toggles a filter and swaps its opposite", () => {
    const start = parseQuery("kind:page");
    expect(formatQuery(toggleFilter(start, { field: "kind", value: "page" }))).toBe("");
    expect(formatQuery(toggleFilter(start, { field: "kind", value: "page", negate: true }))).toBe("-kind:page");
    expect(formatQuery(toggleFilter(start, { field: "tag", value: "Explore" }))).toBe("kind:page tag:Explore");
  });

  it("suggests fields and values", () => {
    expect(suggest("pro", vocabulary)[0]).toEqual({ type: "field", field: "project", negate: false });
    expect(suggest("project:q4", vocabulary)).toEqual([{ type: "value", negate: false, field: "project", value: "Q4 launch", label: "Q4 launch" }]);
    expect(suggest("-kind:dict", vocabulary)[0]).toMatchObject({ value: "dictation", negate: true });
    expect(suggest("expl", vocabulary)).toEqual([{ type: "value", negate: false, field: "tag", value: "Explore", label: "Explore" }]);
    expect(describeFilter({ field: "kind", value: "page" }, vocabulary)).toEqual({ field: "Kind", value: "Pages" });
  });
});
