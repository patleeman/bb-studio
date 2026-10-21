import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { eachId, mentionPrompt, studioSchemas } from "./contract";
import { plural, relativeTime, snippet, untitled } from "./format";
import { groupItems, nextSort, parseSort, formatSort, sortItems, toggleSelection, type CollectionItem } from "./app/selection";

// Every value import must be supplied by the kit package or the BB host.
const packageJson = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};
const RUNTIME = new Set([
  ...Object.keys(packageJson.dependencies),
  "@get-bb/plugin-sdk",
  "react",
  "react/jsx-runtime",
  "react-dom",
  "sonner",
  "clsx",
  "tailwind-merge",
  "class-variance-authority",
  "@radix-ui/react-dropdown-menu",
  "@get-bb/plugin-sdk/app",
  "node:crypto",
  "node:child_process",
  "node:util",
  "node:timers/promises",
  "node:fs/promises",
  "node:path",
]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("kit imports", () => {
  it("value-imports only declared dependencies or host modules", () => {
    const offenders: string[] = [];
    for (const file of sources(import.meta.dirname)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/^import\s+(type\s+)?[^;]*?from\s+"([^"]+)";/gms)) {
        const [, typeOnly, from] = match;
        if (typeOnly || from!.startsWith(".")) continue;
        if (!RUNTIME.has(from!)) offenders.push(`${file}: ${from}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("format", () => {
  const now = Date.UTC(2026, 8, 30, 12);
  it("describes recent times", () => {
    expect(relativeTime(now - 10_000, now)).toBe("just now");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
  });
  it("pluralizes and names untitled items", () => {
    expect(plural(1, "page")).toBe("1 page");
    expect(plural(2, "page")).toBe("2 pages");
    expect(untitled("  ")).toBe("Untitled");
  });
  it("excerpts the text around a match", () => {
    expect(snippet("Ship the\n  offline mode", "OFFLINE")).toBe("Ship the offline mode");
    expect(snippet("nothing here", "offline")).toBeNull();
    expect(snippet("anything", "  ")).toBeNull();
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`);
    const text = [...words.slice(0, 30), "pricing", ...words.slice(30)].join(" ");
    const cut = snippet(text, "pricing", 60)!;
    expect(cut).toMatch(/^…word\d+ .*pricing.* word\d+…$/);
    expect(cut.length).toBeLessThanOrEqual(62);
    expect(snippet(`${words.join(" ")} pricing`, "pricing", 40)).toMatch(/^…word\d+ .*pricing$/);
  });
});

describe("contract", () => {
  it("links each item for a new thread", () => {
    expect(mentionPrompt([{ title: "Plan [v2]", href: "/a" }, { title: "", href: "/b" }])).toBe("[Plan v2](/a) [Untitled](/b) ");
  });
  it("reports each id's outcome", async () => {
    const result = await eachId(["a", "b"], (id) => {
      if (id === "b") throw new Error("gone");
    });
    expect(result).toEqual({ done: ["a"], failed: [{ id: "b", error: "gone" }] });
  });
  it("validates items with the caller's zod", () => {
    const schemas = studioSchemas(z);
    const item = {
      id: "pg_1",
      kind: "page",
      title: "Notes",
      icon: null,
      projectId: null,
      parentId: null,
      createdAt: 1,
      updatedAt: 2,
      updatedBy: "agent",
      preview: null,
      facts: [],
      badge: { label: "Live", tone: "live" },
      thumbnailUrl: null,
      href: "/plugins/pages/pages/pg_1",
      archived: false,
    };
    expect(schemas.item.parse(item)).toEqual(item);
    expect(() => schemas.item.parse({ ...item, badge: { label: "x", tone: "loud" } })).toThrow();
    expect(() => schemas.provider.studio_delete.input.parse({ ids: [] })).toThrow();
  });
});

function item(id: string, patch: Partial<CollectionItem> = {}): CollectionItem {
  return {
    pluginId: "pages",
    id,
    kind: "page",
    title: id,
    icon: null,
    projectId: null,
    parentId: null,
    createdAt: 0,
    updatedAt: 0,
    updatedBy: null,
    preview: null,
    facts: [],
    badge: null,
    thumbnailUrl: null,
    href: `/x/${id}`,
    archived: false,
    ...patch,
  };
}

describe("selection", () => {
  const order = ["a", "b", "c", "d"];
  it("toggles one row", () => {
    expect([...toggleSelection(new Set(), order, "b", { range: false, anchor: null })]).toEqual(["b"]);
    expect([...toggleSelection(new Set(["b"]), order, "b", { range: false, anchor: "b" })]).toEqual([]);
  });
  it("extends a range from the anchor in either direction", () => {
    expect([...toggleSelection(new Set(["b"]), order, "d", { range: true, anchor: "b" })].sort()).toEqual(["b", "c", "d"]);
    expect([...toggleSelection(new Set(["d"]), order, "a", { range: true, anchor: "d" })].sort()).toEqual(["a", "b", "c", "d"]);
  });
  it("clears a range when the clicked row was checked", () => {
    expect([...toggleSelection(new Set(order), order, "c", { range: true, anchor: "a" })]).toEqual(["d"]);
  });
});

describe("sorting", () => {
  const context = { kindLabel: (i: CollectionItem) => i.kind, projectLabel: (i: CollectionItem) => i.projectId ?? "Global" };
  it("sorts by title naturally", () => {
    const items = [item("Item 10"), item("item 2"), item("Item 1")];
    expect(sortItems(items, { key: "title", descending: false }, context).map((i) => i.id)).toEqual(["Item 1", "item 2", "Item 10"]);
  });
  it("puts items missing a fact last in both directions", () => {
    const items = [
      item("none"),
      item("short", { facts: [{ id: "length", value: "1:00", sort: 60 }] }),
      item("long", { facts: [{ id: "length", value: "9:00", sort: 540 }] }),
    ];
    for (const descending of [true, false]) {
      expect(sortItems(items, { key: "fact:length", descending }, context).at(-1)!.id).toBe("none");
    }
  });
  it("starts dates and facts newest or largest first", () => {
    expect(nextSort({ key: "title", descending: false }, "updatedAt")).toEqual({ key: "updatedAt", descending: true });
    expect(nextSort({ key: "updatedAt", descending: true }, "title")).toEqual({ key: "title", descending: false });
    expect(nextSort({ key: "title", descending: false }, "title")).toEqual({ key: "title", descending: true });
  });
  it("stores a sort as text and falls back on junk", () => {
    expect(parseSort(formatSort({ key: "fact:length", descending: false }))).toEqual({ key: "fact:length", descending: false });
    expect(parseSort("nonsense")).toEqual({ key: "updatedAt", descending: true });
  });
});

describe("grouping", () => {
  const label = (id: string) => id || "None";
  const ids = (groups: ReturnType<typeof groupItems>) => groups.map((group) => [group.label, group.items.map((each) => each.id)]);
  it("orders groups by their most recent item, keeping the sort within each, and items with none last", () => {
    const items = [item("a", { projectId: "p1", updatedAt: 50 }), item("b", { updatedAt: 90 }), item("c", { projectId: "p2", updatedAt: 70 }), item("d", { projectId: "p1", updatedAt: 60 })];
    expect(ids(groupItems(items, "project", { label }))).toEqual([["p2", ["c"]], ["p1", ["a", "d"]], ["None", ["b"]]]);
  });
  it("groups by the thread that made each item", () => {
    const thread = (id: string) => ({ id, title: id.toUpperCase() });
    const items = [item("a", { thread: thread("t1"), updatedAt: 10 }), item("b", { thread: null, updatedAt: 99 }), item("c", { thread: thread("t2"), updatedAt: 30 }), item("d", { thread: thread("t1"), updatedAt: 20 })];
    expect(ids(groupItems(items, "thread", { label }))).toEqual([["t2", ["c"]], ["t1", ["a", "d"]], ["None", ["b"]]]);
  });
  it("groups by kind", () => {
    const items = [item("a", { kind: "page", updatedAt: 1 }), item("b", { kind: "drawing", updatedAt: 2 })];
    expect(ids(groupItems(items, "kind", { label }))).toEqual([["drawing", ["b"]], ["page", ["a"]]]);
  });
  it("shows an item under each of its tags, and untagged items last", () => {
    const items = [item("a", { tags: ["s2", "s1"], updatedAt: 5 }), item("b", { updatedAt: 9 }), item("c", { tags: ["s1"], updatedAt: 1 })];
    expect(ids(groupItems(items, "tag", { label }))).toEqual([["s1", ["a", "c"]], ["s2", ["a"]], ["None", ["b"]]]);
  });
  it("breaks ties by label", () => {
    const items = [item("a", { projectId: "p2", updatedAt: 1 }), item("b", { projectId: "p1", updatedAt: 1 })];
    const labels: Record<string, string> = { p1: "Zebra", p2: "Apple" };
    expect(groupItems(items, "project", { label: (id) => labels[id]! }).map((group) => group.label)).toEqual(["Apple", "Zebra"]);
  });
});
