import { expect, it } from "vitest";
import { registerNewTabItems } from "./kit/app/host-sdk";
import { newTabRecents, newTabSearch, shownKind, type NewTabSearchSources, type NewTabSources } from "./newtab";
import { kindsNamedBy, TAB_KIND_REGISTRY } from "./tab-kinds";
import { newTabItems, openedEntries, openedSearch, openNewTabEntry, STUDIO_NEW_TAB_ITEMS } from "./ui/newtab-items";
import type { OpenDeps } from "./ui/tab-open";

const PAGE = "pg_plan";
const DESIGN = "dsn_0123456789abcdef";
const MINI = "mini_0123456789abcdef";
const REC = "rec_0123456789";

const sources = (over: Partial<NewTabSources> = {}): NewTabSources => ({
  items: (limit) => [
    { id: PAGE, title: "Plan", updatedAt: 500 },
    { id: DESIGN, title: "", updatedAt: 300 },
    { id: MINI, title: "Timer", updatedAt: 900 },
    { id: REC, title: "Standup", updatedAt: 50 },
    { id: "x_unknown", title: "Not ours", updatedAt: 2000 },
  ].slice(0, limit),
  botThreads: async () => [
    { threadId: "thr_here", kind: "conversation" as const, title: "This one", updatedAt: 1000 },
    { threadId: "thr_w", kind: "worker" as const, title: "Fix the build", updatedAt: 700 },
    { threadId: "thr_c", kind: "conversation" as const, title: "", updatedAt: 100 },
  ],
  boards: async () => [{ threadId: "thr_board", title: "Election night", updatedAt: 600 }],
  bots: () => [{ id: "bot_main", name: "Chief of Staff", updatedAt: 200 }],
  ...over,
});

it("merges every kind the server keeps, newest first and named by the registry, without the panel's own conversation", async () => {
  const entries = await newTabRecents(sources(), { threadId: "thr_here", limit: 10 });
  expect(entries.map((entry) => [entry.title, entry.kind, entry.updatedAt])).toEqual([
    ["Timer", "App", 900],
    ["Fix the build", "Worker", 700],
    ["Election night", "Visual Chat board", 600],
    ["Plan", "Page", 500],
    ["Untitled", "Design", 300],
    ["Chief of Staff", "Bot", 200],
    ["Untitled conversation", "Conversation", 100],
    ["Standup", "Recording", 50],
  ]);
  expect(entries[2]!.ref).toEqual({ kind: "board", id: "thr_board" });
  expect(entries[3]!.ref).toEqual({ kind: "page", id: PAGE });
});

it("keeps Recent to the newest few and survives a missing Visual Chat", async () => {
  const entries = await newTabRecents(sources({ boards: async () => { throw new Error("Not installed"); } }), { threadId: null, limit: 2 });
  expect(entries.map((entry) => entry.id)).toEqual(["conversation:thr_here", "worker:thr_w"]);
});

it("searches the same rows, best match first; a query naming a kind lists that kind's newest", async () => {
  const search: NewTabSearchSources = {
    items: () => [{ row: { id: PAGE, title: "Night plan", updatedAt: 100 }, score: 4 }],
    itemsOfKinds: (kinds) => (kinds.includes("whiteboard") ? [{ id: "drw_0123456789abcdef", title: "Floor plan", updatedAt: 400 }] : []),
    botThreads: async () => [{ row: { threadId: "thr_n", kind: "conversation", title: "Night shift", updatedAt: 50 }, score: 8 }],
    boards: async () => [{ threadId: "thr_board", title: "Election night", updatedAt: 600 }, { threadId: "thr_other", title: "Budget", updatedAt: 900 }],
    bots: () => [{ id: "bot_night", name: "Night owl", updatedAt: 10 }],
    entries: async () => [{ kind: "todo", id: "loop_1", title: "Book the night train", updatedAt: 5 }, { kind: "automation", id: "bot_night:aut_1", title: "Morning card", updatedAt: 700 }, { kind: "record", id: "mem_1", title: "Travel: sleeps badly at night", updatedAt: 3 }],
  };
  const entries = await newTabSearch(search, { query: "night", threadId: null });
  expect(entries.map((entry) => entry.title)).toEqual(["Night shift", "Night owl", "Election night", "Night plan", "Book the night train", "Travel: sleeps badly at night"]);
  expect(entries.slice(4).map((entry) => [entry.kind, entry.ref])).toEqual([["Todo", { kind: "todo", id: "loop_1" }], ["Memory record", { kind: "record", id: "mem_1" }]]);
  expect((await newTabSearch(search, { query: "automations", threadId: null })).map((entry) => [entry.title, entry.kind])).toContainEqual(["Morning card", "Automation"]);
  expect(await newTabSearch(search, { query: "night", threadId: "thr_n" })).toHaveLength(5);
  expect((await newTabSearch(search, { query: "whiteboards", threadId: null })).map((entry) => [entry.title, entry.kind])).toContainEqual(["Floor plan", "Whiteboard"]);
  expect((await newTabSearch(search, { query: "night", threadId: null })).map((entry) => entry.kind)).not.toContain("Whiteboard");
  expect(await newTabSearch(search, { query: "  ", threadId: null })).toEqual([]);
});

it("adds the pages this window opened last, named for their kind, and finds them by name", () => {
  const opened = [{ kind: "memory" as const, id: "bot_main", at: 800 }, { kind: "vscode" as const, id: null, at: 300 }];
  expect(openedEntries(opened).map((entry) => [entry.title, entry.kind, entry.ref])).toEqual([
    ["Memory", "Memory", { kind: "memory", id: "bot_main" }],
    ["VS Code", "VS Code", { kind: "vscode", id: null }],
  ]);
  expect(openedSearch("mem", opened).map((entry) => entry.title)).toEqual(["Memory"]);
  expect(openedSearch("automations", opened)).toEqual([]);
});

const recordingDeps = (opened: unknown[]): OpenDeps => ({
  workbench: (threadId) => (threadId === "thr_here" ? { open: async (spec, options) => { opened.push([spec, options]); return "k1"; } } : null),
  requestThreadTab: async () => false, requestPageTab: async () => false,
  requestPluginTab: async (open, place) => { opened.push(["plugin", open, place]); return "kb"; },
  noteOpened: () => {},
});

it("opens every row as a tab in the conversation's panel, a board as Visual Chat's tab", async () => {
  const opened: unknown[] = [];
  const toThread: string[] = [];
  const navigate = { toThread: (id: string) => { toThread.push(id); } } as never;
  const entries = await newTabRecents(sources(), { threadId: "thr_here", limit: 10 });
  const byKind = (kind: string) => entries.find((entry) => entry.kind === kind)!;
  for (const kind of ["Page", "Worker", "Visual Chat board", "Bot"]) await openNewTabEntry(byKind(kind), "thr_here", navigate, recordingDeps(opened));
  expect(opened).toEqual([
    [{ kind: "tab", tab: { id: "studio" }, params: { kind: "page", id: PAGE }, title: "Plan" }, { focus: true }],
    [{ kind: "tab", tab: { id: "thread" }, params: { threadId: "thr_w" }, title: "Fix the build" }, { focus: true }],
    [{ kind: "tab", tab: { id: "board", pluginId: "studio-visual-chat" }, params: { threadId: "thr_board" }, title: "Election night" }, { focus: true }],
    [{ kind: "tab", tab: { id: "bot" }, params: { botId: "bot_main" }, title: "Chief of Staff" }, { focus: true }],
  ]);
  // Without a conversation's panel, a thread opens in the main view.
  await openNewTabEntry(byKind("Worker"), null, navigate, recordingDeps(opened));
  expect(toThread).toEqual(["thr_w"]);
});

it("gives every row the drag payload its kind drops as", async () => {
  const entries = await newTabRecents(sources(), { threadId: null, limit: 10 });
  const items = newTabItems(entries, null, {} as never);
  const payload = { Conversation: "thread", Worker: "thread", Page: "doc", Design: "doc", App: "doc", Recording: "doc", Bot: "tab", "Visual Chat board": "tab" } as Record<string, string>;
  expect(items.map((item) => item.experimental_dragItem?.kind)).toEqual(entries.map((entry) => payload[entry.kind]));
});

it("searches under each kind's plural, with Recent on its own registration", () => {
  expect(STUDIO_NEW_TAB_ITEMS[0]).toMatchObject({ id: "recent" });
  expect(STUDIO_NEW_TAB_ITEMS.slice(1).map((registration) => registration.title)).toEqual([...new Set(TAB_KIND_REGISTRY.filter((entry) => entry.owner !== "bb").map((entry) => entry.plural))]);
  expect(STUDIO_NEW_TAB_ITEMS.map((registration) => registration.id)).toEqual(expect.arrayContaining(["kind-automations", "kind-todos", "kind-record"]));
  expect(STUDIO_NEW_TAB_ITEMS.map((registration) => registration.id)).not.toContain("kind-todo");
  expect(STUDIO_NEW_TAB_ITEMS.slice(1).every((registration) => !registration.useRecents && registration.search)).toBe(true);
  expect(STUDIO_NEW_TAB_ITEMS.map((registration) => registration.title)).not.toContain("Studio");
  const titles = STUDIO_NEW_TAB_ITEMS.map((registration) => registration.title);
  expect(titles.filter((title) => title === "Apps")).toHaveLength(1);
  expect(titles).not.toContain("Artifacts");
  expect(kindsNamedBy("apps")).toEqual(["app", "artifact"]);
});

it("registers only on a BB that has the New Tab slot", () => {
  const registered: unknown[] = [];
  const registration = { id: "studio", title: "Studio" };
  expect(registerNewTabItems({ navPanel() {} }, registration)).toBe(false);
  expect(registerNewTabItems({ experimental_newTabItems: (value: unknown) => { registered.push(value); } }, registration)).toBe(true);
  expect(registered).toEqual([registration]);
});

it("names a row's kind after its title only where the title doesn't already name it", () => {
  expect(shownKind({ title: "Todos", kind: "Todos" })).toBe("");
  expect(shownKind({ title: "Plan", kind: "Page" })).toBe("Page");
});
