// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { NEW_TAB_ACTIONS, tabKindEntry } from "../tab-kinds";
import { noteOpenedTab, openedTabs } from "./opened-tabs";
import { openMade, registerTabKindTabs } from "./tab-kind-tabs";

it("registers the Bot pages and the New … actions beside a conversation, named by the registry", () => {
  const tabs: { id: string; title: string; context: { kind: string }; run?: unknown; experimental_showInNewTab?: unknown }[] = [];
  registerTabKindTabs({ slots: { experimental_tab: (tab: never) => { tabs.push(tab); } } });
  expect(tabs.map((tab) => [tab.id, tab.title, tab.context.kind, typeof tab.run])).toEqual([
    ["memory", "Memory", "thread", "undefined"],
    ["library", "Library", "thread", "undefined"],
    ["bot-automations", "Automations", "thread", "undefined"],
    ["archive", "Archive", "thread", "undefined"],
    ["automation", "Automation", "thread", "undefined"],
    ["todo", "Todo", "thread", "undefined"],
    ["memory-record", "Memory record", "thread", "undefined"],
    ...NEW_TAB_ACTIONS.filter((action) => action.create).map((action) => [action.tabId, action.title, "thread", "function"]),
  ]);
  expect(tabs.filter((tab) => "experimental_showInNewTab" in tab).map((tab) => tab.id)).toEqual(["automation", "todo", "memory-record"]);
});

it("opens what a New … action made as a tab beside the conversation, else in the main view", () => {
  const openTab = vi.fn(() => true);
  openMade({ openTab }, "/plugins/studio/studio/drawings/drw_0123456789abcdef", "Untitled whiteboard");
  expect(openTab).toHaveBeenCalledWith({ tab: { id: "studio", context: { kind: "thread" }, availability: "action" }, params: { kind: "drawing", id: "drw_0123456789abcdef" }, title: "Untitled whiteboard" });
  expect(tabKindEntry("whiteboard").actions[0]).toEqual({ tabId: "new-whiteboard", group: "New" });
});

it("keeps the newest open of each page kind, and nothing of kinds listed elsewhere", () => {
  const store = new Map<string, string>();
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
  noteOpenedTab({ kind: "memory", id: "bot_a" }, 100, storage);
  noteOpenedTab({ kind: "page", id: "pg_x" }, 200, storage);
  noteOpenedTab({ kind: "vscode", id: null }, 300, storage);
  noteOpenedTab({ kind: "memory", id: "bot_b" }, 400, storage);
  expect(openedTabs(storage)).toEqual([{ kind: "memory", id: "bot_b", at: 400 }, { kind: "vscode", id: null, at: 300 }]);
  store.set("studio.openedTabs", "not json");
  expect(openedTabs(storage)).toEqual([]);
});
