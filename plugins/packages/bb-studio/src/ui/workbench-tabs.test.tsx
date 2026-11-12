// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const PAGE_ID = "pg_0123456789abcdef";
const hits = [
  { ref: { pluginId: "bb", id: "thr_a" }, kind: "thread", title: "Fix login", href: "/threads/thr_a" },
  { ref: { pluginId: "pages", id: PAGE_ID }, kind: "page", title: "Launch plan", href: `/plugins/studio/studio/pages/${PAGE_ID}` },
  { ref: { pluginId: "forecast", id: "f_1" }, kind: "forecast", title: "No tab for me", href: "/plugins/forecast/forecast/f_1" },
];
const rpc = { call: vi.fn(async (_method: string, input: { kinds?: string[] }) => (input.kinds ? hits.filter((hit) => hit.kind === "thread") : hits)) };
const live: Record<string, unknown> = {
  bot_list: { bots: [{ id: "bot_main", name: "Chief of Staff", avatar: "🤖", state: "active", threadId: "thr_bot" }] },
  bot_attention: { attention: { reason: "8" } },
};
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useRpc: () => rpc,
  experimental_useAppPanel: () => ({}),
  experimental_usePanelTabs: () => ({ open: true, selectedKey: null, tabs: [] }),
  experimental_useSidebarThreads: () => ({ threads: [], projects: [] }),
  ThreadChat: ({ threadId }: { threadId: string }) => <div data-chat={threadId} />,
}));
vi.mock("./live", () => ({ useLive: (method: string) => ({ data: live[method], refresh() {} }) }));
vi.mock("../presence/ui/BotFace", () => ({ BotFace: () => <i data-avatar="" /> }));
vi.mock("./bot/BotAvatar", () => ({ botProvider: () => null }));
vi.mock("../kit/app/index", () => ({ Icon: () => null }));
vi.mock("./bot/ThreadsSection", () => ({ compactAge: () => "1h" }));

import { registerWorkbenchTabs, targetForHit, WorkbenchPicker, type WorkbenchTarget } from "./workbench-tabs";

let root: Root;
let container: HTMLElement;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it("opens a thread as a thread tab and an item as the Studio tab, and skips what has no workbench view", () => {
  expect(hits.map(targetForHit)).toEqual([
    { tabId: "thread", params: { threadId: "thr_a" }, title: "Fix login" },
    { tabId: "studio", params: { kind: "page", id: PAGE_ID }, title: "Launch plan" },
    null,
  ]);
});

it("lists Bots in their own section as cards, apart from threads and items", async () => {
  const picked: WorkbenchTarget[] = [];
  await act(async () => { root.render(<WorkbenchPicker onPick={(target) => picked.push(target)} />); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  const sections = [...container.querySelectorAll("section")].map((section) => section.getAttribute("aria-label"));
  expect(sections).toEqual(["Bots", "Threads", "Items"]);
  const bot = container.querySelector<HTMLElement>("[data-testid=picker-bot]")!;
  expect(bot.querySelector("[data-avatar]")).not.toBeNull();
  expect(bot.textContent).toBe("Chief of Staff8");
  expect(container.querySelectorAll("[data-testid=picker-row]")).toHaveLength(2);
  expect(container.querySelector("[aria-label=Threads] [data-testid=picker-bot]")).toBeNull();
  await act(async () => { bot.click(); });
  expect(picked).toEqual([{ tabId: "bot", params: { botId: "bot_main" }, title: "Chief of Staff" }]);
});

it("registers the new-thread-about-an-item tab for a thread's workbench, and for the Studio page's where it has one", () => {
  const tabs = (page: boolean) => {
    const registered: string[] = [];
    registerWorkbenchTabs({ slots: { experimental_tab: (tab) => { if (tab.id === "item-thread") registered.push(tab.context.kind); } } }, { page });
    return registered;
  };
  expect(tabs(false)).toEqual(["thread"]);
  expect(tabs(true)).toEqual(["thread", "nav-panel"]);
});

it("leaves the workbench's + to BB: no tab takes over the new tab page, and only Thread is listed on it", () => {
  const registered: { id: string; kind: string; newTab: boolean; listed: unknown }[] = [];
  registerWorkbenchTabs({ slots: { experimental_tab: (tab) => { registered.push({ id: tab.id, kind: tab.context.kind, newTab: "experimental_newTab" in tab, listed: (tab as { experimental_showInNewTab?: unknown }).experimental_showInNewTab }); } } }, { page: true });
  expect([...new Set(registered.map((tab) => tab.id))]).toEqual(["thread", "bot", "item-thread"]);
  expect(registered.some((tab) => tab.newTab)).toBe(false);
  expect(registered.map(({ id, kind, listed }) => [id, kind, listed])).toEqual([
    ["thread", "thread", undefined], ["thread", "nav-panel", undefined],
    ["bot", "thread", false], ["bot", "nav-panel", false],
    ["item-thread", "thread", false], ["item-thread", "nav-panel", false],
  ]);
});
