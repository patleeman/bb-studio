import { expect, it } from "vitest";
import type { LibraryItem } from "../../bot-threads-contract";
import { dateGroup, foldRows, GROUP_FOLD, LIBRARY_APP_TYPES, LIBRARY_KINDS, libraryGroups, libraryPasses, libraryRows, provenance, titleStem } from "./library-model";

const DAY = 24 * 60 * 60_000;
const NOW = new Date(2026, 10, 11, 15, 0).getTime();

const item = (over: Partial<LibraryItem> & { id: string }): LibraryItem => ({ pluginId: "pages", title: over.id, kind: "page", type: "doc", href: `/p/${over.id}`, updatedAt: NOW, createdAt: null, madeIn: null, ...over });
const inConversation = (threadId: string, title: string) => ({ threadId, title, kind: "conversation" as const, conversationId: threadId, conversationTitle: title });
const byWorker = (threadId: string, title: string, conversationId: string, conversationTitle: string) => ({ threadId, title, kind: "worker" as const, conversationId, conversationTitle });

const files = [
  item({ id: "outline", title: "System design round: the outline", madeIn: inConversation("prep", "Launch prep"), updatedAt: NOW - 2 * 60 * 60_000 }),
  item({ id: "timer", title: "Round timer", kind: "app", type: "mini", madeIn: inConversation("prep", "Launch prep"), updatedAt: NOW - 60 * 60_000 }),
  item({ id: "chess", title: "Breakdown: Online chess", madeIn: byWorker("w_fable", "Fable: Breakdown pages", "prep", "Launch prep"), updatedAt: NOW - DAY - 60_000 }),
  item({ id: "kind", title: "One kind of thing", kind: "design", type: "design", madeIn: inConversation("fork", "Fork redesign"), updatedAt: NOW - 2 * 60_000 }),
  item({ id: "house", title: "43 Chadwick: House", madeIn: null, updatedAt: NOW - 40 * DAY }),
];

it("groups by conversation (default): a worker's files under the conversation that started it, the newest group first", () => {
  const groups = libraryGroups(files, { query: "", kind: "all", groupBy: "conversation" }, NOW);
  expect(groups.map((group) => [group.title, group.threadId, group.items.map((each) => each.id)])).toEqual([
    ["Fork redesign", "fork", ["kind"]],
    ["Launch prep", "prep", ["timer", "outline", "chess"]],
    ["Made by you", null, ["house"]],
  ]);
});

it("groups by kind in the New menu's order, and by date from today back", () => {
  expect(libraryGroups(files, { query: "", kind: "all", groupBy: "kind" }, NOW).map((group) => group.title)).toEqual(["Pages", "Designs", "Apps"]);
  expect(libraryGroups(files, { query: "", kind: "all", groupBy: "date" }, NOW).map((group) => [group.title, group.items.length])).toEqual([["Today", 3], ["Yesterday", 1], ["Older", 1]]);
  expect(dateGroup(NOW - 3 * DAY, NOW).title).toBe("This week");
  expect(dateGroup(NOW - 20 * DAY, NOW).title).toBe("This month");
});

it("filters by kind and searches titles and where a file came from", () => {
  expect(libraryGroups(files, { query: "", kind: "app", groupBy: "conversation" }, NOW).flatMap((group) => group.items.map((each) => each.id))).toEqual(["timer"]);
  expect(libraryPasses(files[2]!, "fable chess", "all")).toBe(true);
  expect(libraryPasses(files[2]!, "launch", "all")).toBe(true);
  expect(libraryPasses(files[2]!, "launch", "design")).toBe(false);
  expect(libraryGroups(files, { query: "nothing like it", kind: "all", groupBy: "kind" }, NOW)).toEqual([]);
});

it("lists saved apps (artifacts) under App, with Interactive and Saved narrowing it", () => {
  const withSaved = [...files, item({ id: "report", title: "Q3 report", kind: "artifact", type: "artifact", madeIn: inConversation("prep", "Launch prep"), updatedAt: NOW - 30 * 60_000 })];
  const ids = (appType: "all" | "interactive" | "saved") => libraryGroups(withSaved, { query: "", kind: "app", appType, groupBy: "date" }, NOW).flatMap((group) => group.items.map((each) => each.id));
  expect(ids("all")).toEqual(["report", "timer"]);
  expect(ids("interactive")).toEqual(["timer"]);
  expect(ids("saved")).toEqual(["report"]);
  expect(libraryGroups(withSaved, { query: "", kind: "all", groupBy: "kind" }, NOW).map((group) => [group.title, group.items.length])).toEqual([["Pages", 3], ["Designs", 1], ["Apps", 2]]);
  expect(LIBRARY_KINDS.map((each) => each.label)).toEqual(["All", "Starred", "Page", "Whiteboard", "Design", "App", "Recording"]);
  expect(LIBRARY_APP_TYPES.map((each) => each.label)).toEqual(["All apps", "Interactive", "Saved"]);
});

it("lists recordings under Recording, and as a Recordings group after Apps", () => {
  const withRecording = [...files, item({ id: "rec_call", pluginId: "talk", title: "Supplier call", kind: "recording", type: "recording", updatedAt: NOW - 3 * 60_000 })];
  expect(libraryGroups(withRecording, { query: "", kind: "recording", groupBy: "date" }, NOW).flatMap((group) => group.items.map((each) => each.id))).toEqual(["rec_call"]);
  expect(libraryGroups(withRecording, { query: "", kind: "all", groupBy: "kind" }, NOW).map((group) => group.title)).toEqual(["Pages", "Designs", "Apps", "Recordings"]);
});

it("shows only starred files under Starred, whatever their kind", () => {
  const withStars = [...files, item({ id: "fav", title: "Pinned timer", kind: "app", type: "mini", starred: true, updatedAt: NOW - 5 * 60_000 }), item({ id: "fav2", title: "Pinned page", starred: true, updatedAt: NOW - 10 * 60_000 })];
  expect(libraryGroups(withStars, { query: "", kind: "starred", groupBy: "date" }, NOW).flatMap((group) => group.items.map((each) => each.id))).toEqual(["fav", "fav2"]);
  expect(libraryPasses(withStars[5]!, "timer", "starred")).toBe(true);
  expect(libraryPasses(withStars[5]!, "page", "starred")).toBe(false);
  expect(libraryPasses(files[0]!, "", "starred")).toBe(false);
});

it("says where a file came from", () => {
  expect(provenance(files[0]!)).toBe("made in Launch prep");
  expect(provenance(files[2]!)).toBe("by Fable: Breakdown pages");
  expect(provenance(files[4]!)).toBe("made by you");
});

it("folds near-identical files from one source into one row with a count, the newest showing; never across sources or kinds", () => {
  const mock = inConversation("mock", "Mockups: one kind of thing + HUD");
  const rows = libraryRows([
    item({ id: "a1", kind: "artifact", title: "Real @pierre/trees 1.0.0 as BB's explorer (threads and docs in folders)", madeIn: mock }),
    item({ id: "a2", kind: "artifact", title: "Real @pierre/trees 1.0.0 as BB's explorer (threads and docs in folders)", madeIn: mock }),
    item({ id: "b1", kind: "artifact", title: "Real @pierre/trees explorer in BB colours: pierre-trees-filter.png", madeIn: mock }),
    item({ id: "b2", kind: "artifact", title: "Real @pierre/trees explorer in BB colours: pierre-trees-expanded.png", madeIn: mock }),
    item({ id: "b3", kind: "page", title: "Real @pierre/trees explorer in BB colours: notes", madeIn: mock }),
    item({ id: "c1", kind: "artifact", title: "Real @pierre/trees explorer in BB colours: other.png", madeIn: inConversation("main", "Main") }),
    item({ id: "m1", title: "Same" }), item({ id: "m2", title: "Same" }),
  ]);
  expect(rows.map((row) => [row.item.id, row.count])).toEqual([["a1", 2], ["b1", 2], ["b3", 1], ["c1", 1], ["m1", 1], ["m2", 1]]);
  expect(titleStem("Breakdown: GPU job scheduler")).toBe("breakdown: gpu job scheduler");
});

it("shows a group's first 8 rows, then how many more", () => {
  const rows = libraryRows(Array.from({ length: 11 }, (_, n) => item({ id: `p${n}`, title: `Page ${n}` })));
  expect(foldRows(rows, false)).toMatchObject({ more: 3 });
  expect(foldRows(rows, false).shown).toHaveLength(GROUP_FOLD);
  expect(foldRows(rows, true)).toMatchObject({ more: 0 });
  expect(foldRows(rows.slice(0, 8), false).more).toBe(0);
  expect(libraryGroups(files, { query: "", kind: "all", groupBy: "conversation" }, NOW)[1]!.rows.map((row) => row.item.id)).toEqual(["timer", "outline", "chess"]);
});
