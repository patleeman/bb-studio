import { expect, it } from "vitest";
import { askText, launcherKey, launcherRows, MATCH, matchScore, MAX_DOCUMENTS, sectionLabelAt, sectionStarts, urlOf, type LauncherDocument, type LauncherEntry } from "./rank";

const entry = (title: string, section: LauncherEntry["section"], extra: Partial<LauncherEntry> = {}): LauncherEntry => ({ key: `studio/${title.toLowerCase().replace(/\s+/g, "-")}`, title, icon: "AppWindow", section, ...extra });
const ENTRIES = [
  entry("BB Studio", "apps", { order: 10, keywords: ["main window"] }),
  entry("HUD", "apps", { order: 20, keywords: ["bot", "chat"] }),
  entry("Visual Chat", "apps", { order: 30 }),
  entry("VS Code", "apps", { order: 40, keywords: ["editor"] }),
  entry("New thread", "actions", { order: 10 }),
  entry("New page", "actions", { order: 20, keywords: ["document"] }),
  entry("Open Activity", "actions", { order: 30 }),
];
const doc = (title: string, updatedAt: number, extra: Partial<LauncherDocument> = {}): LauncherDocument => ({ key: `doc:${title}`, title, icon: "FileText", kind: "Page", path: `/plugins/pages/pages/${encodeURIComponent(title)}`, updatedAt, ...extra });
const titles = (rows: readonly { title: string }[]) => rows.map((row) => row.title);
const labels = (rows: Parameters<typeof sectionLabelAt>[0], typed = true) => rows.map((_, index) => sectionLabelAt(rows, index, typed)).filter(Boolean);

it("ranks a prefix over a word start over a substring over a keyword", () => {
  expect(matchScore("vis", "Visual Chat")).toBe(MATCH.prefix);
  expect(matchScore("chat", "Visual Chat")).toBe(MATCH.wordStart);
  expect(matchScore("v c", "Visual Chat")).toBe(MATCH.wordStart);
  expect(matchScore("sual", "Visual Chat")).toBe(MATCH.substring);
  expect(matchScore("editor", "VS Code", ["editor"])).toBe(MATCH.keyword);
  expect(matchScore("zzz", "VS Code", ["editor"])).toBe(MATCH.none);
  expect(matchScore("CAFE", "Café plans")).toBe(MATCH.prefix);
  expect(matchScore("  ", "anything")).toBe(MATCH.prefix);
});

it("with nothing typed in commands mode, lists every app and action in their order, then the newest conversations and files, then commands and settings", () => {
  const documents = Array.from({ length: 12 }, (_, index) => doc(`Doc ${index}`, index));
  const all = [...ENTRIES, entry("Rename thread", "commands"), entry("HUD", "settings", { key: "studio:setting:hudEnabled", detail: "On" })];
  const rows = launcherRows({ query: "", entries: all, documents, botName: "Dot" });
  expect(titles(rows).slice(0, 7)).toEqual(["BB Studio", "HUD", "Visual Chat", "VS Code", "New thread", "New page", "Open Activity"]);
  const recent = rows.filter((row) => row.section === "documents");
  expect(recent).toHaveLength(MAX_DOCUMENTS);
  expect(titles(recent).slice(0, 3)).toEqual(["Doc 11", "Doc 10", "Doc 9"]);
  expect(titles(rows).slice(-2)).toEqual(["Rename thread", "HUD"]);
  expect(labels(rows, false)).toEqual(["Apps", "Actions", "Recent", "Commands", "Settings"]);
  expect(rows.some((row) => row.type === "ask")).toBe(false);
});

it("search mode starts on the recent conversations and files alone, and ranks a query like commands mode", () => {
  const documents = [doc("Plan the offsite", 9), doc("Budget", 3)];
  const empty = launcherRows({ query: "", mode: "search", entries: ENTRIES, documents, botName: "Dot" });
  expect(titles(empty)).toEqual(["Plan the offsite", "Budget"]);
  expect(labels(empty, false)).toEqual(["Recent"]);
  const typed = launcherRows({ query: "pla", mode: "search", entries: [...ENTRIES, entry("Planner", "apps")], documents: [doc("The offsite plan", 9)], botName: "Dot" });
  expect(titles(typed)).toEqual(["Planner", "The offsite plan", "Ask Dot: “pla”"]);
  const bodyOnly = launcherRows({ query: "rename", mode: "search", entries: [...ENTRIES, entry("Rename thread", "commands")], documents: [{ ...doc("Design notes", 9), found: true }], botName: "Dot" });
  expect(titles(bodyOnly)).toEqual(["Rename thread", "Design notes", "Ask Dot: “rename”"]);
  const everything = launcherRows({ query: "pla", mode: "commands", entries: [...ENTRIES, entry("Planner", "apps")], documents: [doc("The offsite plan", 9)], botName: "Dot" });
  expect(titles(everything)).toEqual(["Planner", "The offsite plan", "Ask Dot: “pla”"]);
});

it("mixes an entity, a command and Ask for one query, the group with the best match first and Ask last", () => {
  const rows = launcherRows({
    query: "roadmap",
    entries: [...ENTRIES, entry("Open roadmap settings", "commands", { detail: "Settings" })],
    documents: [doc("Roadmap", 4), doc("Unrelated", 9)],
    botName: "Chief of Staff",
  });
  expect(rows.map((row) => [row.type, row.title])).toEqual([
    ["document", "Roadmap"], ["entry", "Open roadmap settings"], ["ask", "Ask Chief of Staff: “roadmap”"],
  ]);
  expect(labels(rows)).toEqual(["Conversations and files", "Commands"]);
  const command = launcherRows({ query: "open road", entries: [entry("Open roadmap settings", "commands")], documents: [doc("Road trip, open questions", 4)], botName: "Chief of Staff" });
  expect(titles(command)).toEqual(["Open roadmap settings", "Road trip, open questions", "Ask Chief of Staff: “open road”"]);
});

it("puts better matches first inside a section, and finds documents Studio's search found by their text", () => {
  const rows = launcherRows({ query: "chat", entries: ENTRIES, documents: [doc("Chatbot ideas", 1), doc("Group chat notes", 9), doc("Unrelated", 99)], botName: null });
  expect(titles(rows)).toEqual(["Chatbot ideas", "Group chat notes", "Visual Chat", "HUD"]);
  expect(titles(launcherRows({ query: "new", entries: ENTRIES, documents: [], botName: null }))).toEqual(["New thread", "New page"]);
  const found = doc("Quarterly plan", 50, { found: true });
  expect(titles(launcherRows({ query: "budget", entries: [], documents: [found, doc("Budget 2026", 1), { ...found, key: "again" }], botName: null }))).toEqual(["Budget 2026", "Quarterly plan"]);
});

it("offers a sentence to the Bot first, unless it starts an app or action, is short, or there is no Bot", () => {
  const rows = launcherRows({ query: "what is  on my plate today", entries: ENTRIES, documents: [], botName: "Dot" });
  expect(rows[0]).toMatchObject({ type: "ask", title: "Ask Dot: “what is on my plate today”", text: "what is on my plate today" });
  expect(sectionLabelAt(rows, 0)).toBeNull();
  expect(askText("new page", ENTRIES)).toBeNull();
  expect(askText("record a call", [...ENTRIES, entry("Record a call now", "actions")])).toBeNull();
  expect(askText("record a call", ENTRIES)).toBe("record a call");
  expect(askText("open the activity", ENTRIES)).toBe("open the activity");
  expect(askText("open the activity", [entry("Open the activity log", "commands")])).toBe("open the activity");
  expect(launcherRows({ query: "what is on my plate", entries: ENTRIES, documents: [], botName: null }).some((row) => row.type === "ask")).toBe(false);
});

it("turns a typed address into an Open row, first", () => {
  expect(urlOf("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
  expect(urlOf("bb://page/pg_0123456789abcdef")).toBe("bb://page/pg_0123456789abcdef");
  expect(urlOf("/threads/thr_1")).toBe("/threads/thr_1");
  expect(urlOf("bb://")).toBeNull();
  expect(urlOf("/notes")).toBeNull();
  expect(urlOf("example.com")).toBe("https://example.com/");
  expect(urlOf("www.example.zz/path")).toBe("https://www.example.zz/path");
  expect(urlOf("docs.github.io/bb")).toBe("https://docs.github.io/bb");
  expect(urlOf("localhost:5173")).toBe("http://localhost:5173/");
  expect(urlOf("192.168.1.4:8000/x")).toBe("http://192.168.1.4:8000/x");
  for (const text of ["notes.md", "app.tsx", "v1.2", "roadmap", "plan the offsite", "ftp://example.com", "https://", ""]) expect(urlOf(text)).toBeNull();
  const rows = launcherRows({ query: "github.com", entries: ENTRIES, documents: [doc("github.com notes", 1)], botName: "Dot" });
  expect(rows.map((row) => [row.type, row.title])).toEqual([["url", "Open https://github.com"], ["document", "github.com notes"], ["ask", "Ask Dot: “github.com”"]]);
  expect(rows[0]).toMatchObject({ url: "https://github.com/" });
});

it("moves with the arrows and wraps, jumps between groups with Tab, runs with Enter (⇧ and ⌘ noted) and ⌘1…⌘9, and Esc clears before it closes", () => {
  const at = { selected: 0, count: 3, query: "" };
  expect(launcherKey({ key: "ArrowDown" }, at)).toEqual({ type: "move", to: 1 });
  expect(launcherKey({ key: "ArrowUp" }, at)).toEqual({ type: "move", to: 2 });
  expect(launcherKey({ key: "ArrowDown" }, { ...at, selected: 2 })).toEqual({ type: "move", to: 0 });
  expect(launcherKey({ key: "Enter" }, { ...at, selected: 1 })).toEqual({ type: "run", index: 1, shift: false, alternate: false });
  expect(launcherKey({ key: "Enter", shiftKey: true }, at)).toEqual({ type: "run", index: 0, shift: true, alternate: false });
  expect(launcherKey({ key: "Enter", metaKey: true }, at)).toEqual({ type: "run", index: 0, shift: false, alternate: true });
  expect(launcherKey({ key: "3", metaKey: true }, at)).toEqual({ type: "run", index: 2, shift: false, alternate: false });
  expect(launcherKey({ key: "4", metaKey: true }, at)).toBeNull();
  expect(launcherKey({ key: "3" }, at)).toBeNull();
  expect(launcherKey({ key: "Escape" }, { ...at, query: "vis" })).toEqual({ type: "clear" });
  expect(launcherKey({ key: "Escape" }, at)).toEqual({ type: "close" });
  expect(launcherKey({ key: "Escape" }, { ...at, escape: false })).toBeNull();
  expect(launcherKey({ key: "Enter" }, { selected: 0, count: 0, query: "zzz" })).toBeNull();
  expect(launcherKey({ key: "ArrowDown" }, { selected: 0, count: 0, query: "zzz" })).toBeNull();
  const rows = launcherRows({ query: "", entries: ENTRIES, documents: [doc("A", 1), doc("B", 2)], botName: null });
  const starts = sectionStarts(rows);
  expect(starts).toEqual([0, 4, 7]);
  expect(launcherKey({ key: "Tab" }, { selected: 2, count: rows.length, query: "", starts })).toEqual({ type: "move", to: 4 });
  expect(launcherKey({ key: "Tab" }, { selected: 8, count: rows.length, query: "", starts })).toEqual({ type: "move", to: 0 });
  expect(launcherKey({ key: "Tab", shiftKey: true }, { selected: 5, count: rows.length, query: "", starts })).toEqual({ type: "move", to: 0 });
  expect(launcherKey({ key: "Tab", shiftKey: true }, { selected: 0, count: rows.length, query: "", starts })).toEqual({ type: "move", to: 7 });
  expect(launcherKey({ key: "Tab" }, { selected: 0, count: 2, query: "", starts: [0] })).toBeNull();
});
