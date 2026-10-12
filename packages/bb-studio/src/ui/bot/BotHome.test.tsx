// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  call: vi.fn(async () => ({})),
  openFixedTab: vi.fn((_options: unknown) => true),
  target: null as null | { sequence: number; target: { threadId: string }; clear(): void },
  pathname: "/plugins/studio/bot",
  prefs: { value: "studio/bot", revision: 1 },
  setPref: vi.fn(async (_args: unknown) => ({})),
  navPref: { value: "studio/bot-navigation", revision: 1 },
  activate: vi.fn(),
  inputs: [] as [string, unknown][],
}));
vi.mock("../live", () => ({
  useCall: () => state.call,
  useLive: (method: string, input: unknown) => {
    state.inputs.push([method, input]);
    const bot = (state.data.bot_get as { bot: unknown } | undefined)?.bot;
    const fallback = method === "bot_list" && bot ? { bots: [bot] } : null;
    return { data: state.data[method] ?? fallback, error: null, loading: false, refresh: () => {} };
  },
}));
vi.mock("../ProjectLeads", () => ({ HeartbeatFields: () => null, useHeartbeatForm: () => ({ input: () => ({}) }) }));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  ThreadChat: ({ threadId }: { threadId: string }) => React.createElement("div", { "data-chat": threadId }),
  ThreadTitle: ({ threadId }: { threadId: string }) => React.createElement("span", null, `title:${threadId}`),
  experimental_useAppPanel: () => ({ openFixedTab: state.openFixedTab }),
  experimental_useFixedTabTarget: () => state.target,
  useSdk: () => sdk,
  experimental_SidebarNavigationIcon: () => null,
  experimental_useSidebarNavigation: () => ({
    activeItemId: "studio/bot", isShortcutModifierHeld: false, actions: { activate: state.activate },
    items: [
      { id: "__bb__/new-thread", label: "New thread", icon: { kind: "host", name: "new-thread" }, isVisible: true, isDisabled: false, isLoading: false, shortcut: null, experimental_Accessory: null },
      { id: "__bb__/search-threads", label: "Search", icon: { kind: "host", name: "search" }, isVisible: true, isDisabled: false, isLoading: false, shortcut: null, experimental_Accessory: null },
      { id: "studio/bot", label: "Bot", icon: { kind: "plugin", pluginId: "studio", icon: "Bot" }, isVisible: true, isDisabled: false, isLoading: false, shortcut: null, experimental_Accessory: null },
    ],
  }),
}));
const sdk = { system: { uiPreferences: {
  list: async () => ({ preferences: { "sidebar.threadListProvider": state.prefs, "sidebar.navigationProvider": state.navPref } }),
  set: (args: unknown) => state.setPref(args),
} } };
vi.mock("./Onboarding", () => ({
  Greeting: ({ lines, onStarter }: { lines: string[]; onStarter(starter: unknown): void }) => React.createElement("div", null, lines.join(" "),
    React.createElement("button", { onClick: () => onStarter({ kind: "customize" }) }, "Customize me")),
  Composer: ({ onSend }: { onSend(text: string): void }) => React.createElement("button", { "aria-label": "Send", onClick: () => onSend("") }),
}));
vi.mock("@bb-studio/kit/app", () => ({
  PageColumn: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
  StudioBar: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
  openAppPath: vi.fn(), usePathname: () => state.pathname, DANGER_BUTTON: "", GHOST_BUTTON: "", ICON_BUTTON: "", OUTLINE_BUTTON: "", PRIMARY_BUTTON: "",
}));
vi.mock("@bb-studio/kit/ui", () => ({
  Icon: () => null,
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => React.createElement("input", props),
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => React.createElement("textarea", props),
  Dialog: ({ children }: { children: React.ReactNode }) => React.createElement("div", { role: "dialog" }, children),
  DialogContent: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
  DialogHeader: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
  DialogFooter: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
  DialogTitle: ({ children }: { children: React.ReactNode }) => React.createElement("h2", null, children),
  DialogDescription: ({ children }: { children: React.ReactNode }) => React.createElement("p", null, children),
  DropdownMenu: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => children,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
  DropdownMenuSeparator: () => null,
  DropdownMenuItem: ({ children, onSelect }: { children: React.ReactNode; onSelect(): void }) => React.createElement("button", { onClick: onSelect }, children),
}));

const { ActivityPanel, BOT_PATH, BotHome, BotRedirect } = await import("./BotHome");
const { BotInfoTab, BotThreadsTab } = await import("./BotTabs");
const { BotNavigation, BotThreadList } = await import("./BotSidebar");
const listProps = { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate: () => {}, searchQuery: "" };

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.call.mockClear();
  state.openFixedTab.mockClear();
  state.target = null;
  state.pathname = "/plugins/studio/bot";
  state.setPref.mockClear();
  state.activate.mockClear();
  state.inputs = [];
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
/** Renders and lets the lazily loaded chat arrive. */
const show = async (node: React.ReactNode) => {
  await act(async () => root.render(node));
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
};
const button = (label: string) => [...container.querySelectorAll("button")].find((each) => each.textContent === label)!;

const click = (el: Element | null | undefined) => (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
const thread = (id: string, title: string) => ({ id, title, status: "idle", projectId: "p", updatedAt: 1, relation: "started" as const, needsYou: false, parentId: null as string | null });
const empty = { needsYou: [], inProgress: [], waiting: [], scheduled: [], completed: [], latest: null };
const dot = { id: "bot_main", name: "Dot", avatar: "🟣", shape: "blob", color: "#5b8def", state: "active", threadId: "thr_bot", createdAt: 1, updatedAt: 1 };

test("with no Bot, greets as one; Customize edits the draft and the first message makes it", async () => {
  state.data = { bot_get: { bot: null, run: null } };
  await show(<BotHome />);
  expect(container.textContent).toContain("Hey! I'm your bot.");
  act(() => button("Customize me").click());
  const name = container.querySelector('input[aria-label="Bot name"]') as HTMLInputElement;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Penny"); name.dispatchEvent(new Event("input", { bubbles: true })); });
  act(() => click(container.querySelector('[aria-label="Shape hexagon"]')));
  act(() => button("Save").click());
  expect(container.querySelector("h1")?.textContent).toBe("Penny");
  await act(async () => click(container.querySelector('[aria-label="Send"]')));
  expect(state.call).toHaveBeenCalledWith("bot_create", { name: "Penny", avatar: "🤖", shape: "hexagon", color: "#5b8def" });
});

test("Studio's old Bot address redirects to the Bot's own panel", async () => {
  const { openAppPath } = await import("@bb-studio/kit/app");
  act(() => root.render(<BotRedirect />));
  expect(BOT_PATH).toBe("/plugins/studio/bot");
  expect(openAppPath).toHaveBeenCalledWith("/plugins/studio/bot", { replace: true });
});

test("Activity: one quiet line when all is empty, sections only when non-empty, the recent few completed", () => {
  act(() => root.render(<ActivityPanel loading={false} data={empty} />));
  expect(container.textContent).toBe("Nothing going on right now.");
  expect(container.querySelector("section")).toBeNull();
  const completed = ["a", "b", "c", "d", "e"].map((id) => thread(id, `Done ${id}`));
  act(() => root.render(<ActivityPanel loading={false} data={{ ...empty, waiting: [thread("w", "Friday digest")], completed }} />));
  expect(container.textContent).toContain("Friday digest");
  expect([...container.querySelectorAll("section")].map((section) => section.getAttribute("aria-label"))).toEqual(["Waiting to start", "Recent"]);
  expect(container.textContent).not.toContain("Done d");
  act(() => button("Show all 5").click());
  expect(container.textContent).toContain("Done e");
});

test("the Bots list: the bot on top, Needs you flat, started threads nested under the one that started them; a row opens the Threads tab", async () => {
  state.data = {
    bot_get: { bot: dot, run: null },
    bot_activity: {
      ...empty,
      needsYou: [{ ...thread("t1", "Approve deploy"), needsYou: true }],
      inProgress: [{ ...thread("t3", "Fix flaky test"), status: "active", parentId: "t2" }],
      completed: [thread("t2", "Research CI"), thread("t4", "Weekly digest")],
      scheduled: [{ id: "a1", kind: "automation", name: "Inbox sweep", cron: "0 * * * *", enabled: true, nextRunAt: null }],
    },
    bot_chain: { threadIds: ["thr_old", "thr_bot"] },
  };
  await show(<BotThreadList {...listProps} />);
  const nav = container.querySelector('nav[aria-label="Bots"]')!;
  expect(nav.querySelector("[data-testid=bot-main]")?.textContent).toContain("Dot");
  const groups = [...nav.querySelectorAll("section")].map((section) => section.getAttribute("aria-label"));
  expect(groups).toEqual(["Needs you", "Running", "Recurring", "Recent", "Earlier conversations"]);
  // The running child pulls its parent into Running and nests under it.
  const running = nav.querySelector('section[aria-label="Running"]')!;
  expect(running.querySelector('li > button[data-thread="t2"] + ul button[data-thread="t3"]')).not.toBeNull();
  expect(nav.querySelector('section[aria-label="Recent"]')?.textContent).toContain("Weekly digest");
  expect(nav.querySelector('section[aria-label="Recurring"]')?.textContent).toContain("Inbox sweep");
  // Earlier conversations start closed.
  expect(nav.textContent).not.toContain("title:thr_old");
  await act(async () => click(nav.querySelector('[data-thread="t4"]')));
  expect(state.openFixedTab).toHaveBeenCalledWith({ surface: { kind: "current" }, tab: expect.objectContaining({ panelId: "bot", id: "threads" }), target: { threadId: "t4" } });
  expect(JSON.parse(localStorage.getItem("studio.bot.bot_main.threads")!)).toEqual({ open: ["t4"], active: "t4" });
  expect(nav.querySelector('[data-thread="t4"]')?.getAttribute("aria-current")).toBe("true");
  // Closed groups are remembered.
  act(() => click(nav.querySelector('section[aria-label="Recent"] > button')));
  expect(JSON.parse(localStorage.getItem("studio.bot.sidebar")!).closed).toContain("recent");
  // The page itself has no column of its own; a quiet needs-you indicator in the title bar.
  await show(<BotHome />);
  expect(container.querySelector("nav")).toBeNull();
  expect(container.querySelector('[aria-label="1 needs you"]')).not.toBeNull();
});

test("off the Bot page the Bots list puts BB's list back and shows a placeholder", async () => {
  state.pathname = "/threads/thr_1";
  state.data = { bot_get: { bot: dot, run: null } };
  await show(<BotThreadList {...listProps} />);
  expect(container.querySelector("nav")).toBeNull();
  expect(state.setPref).toHaveBeenCalledWith({ key: "sidebar.threadListProvider", value: "thread-list/thread-list", expectedRevision: 1 });
});

test("when the host declines the Threads tab, the sub-thread opens as a BB thread", async () => {
  const { openAppPath } = await import("@bb-studio/kit/app");
  state.openFixedTab.mockReturnValueOnce(false);
  state.data = { bot_get: { bot: dot, run: null }, bot_activity: { ...empty, completed: [thread("t4", "Weekly digest")] } };
  await show(<BotThreadList {...listProps} />);
  await act(async () => click(container.querySelector('[data-thread="t4"]')));
  expect(openAppPath).toHaveBeenCalledWith("/threads/t4");
});

test("Threads tab: a target adds and focuses the thread, then clears; tabs close and focus moves on", async () => {
  state.data = { bot_get: { bot: dot, run: null }, bot_activity: { ...empty, completed: [thread("t1", "One"), thread("t2", "Two")] } };
  await show(<BotThreadsTab />);
  expect(container.textContent).toContain("Open a thread Dot started");
  const clear = vi.fn();
  state.target = { sequence: 1, target: { threadId: "t1" }, clear };
  await show(<BotThreadsTab />);
  state.target = { sequence: 2, target: { threadId: "t2" }, clear };
  await show(<BotThreadsTab />);
  expect(clear).toHaveBeenCalledTimes(2);
  expect([...container.querySelectorAll("[role=tab]")].map((tab) => tab.textContent)).toEqual(["One", "Two"]);
  expect(container.querySelector("[data-chat]")?.getAttribute("data-chat")).toBe("t2");
  act(() => click(container.querySelector('[role=tab][data-thread="t1"]')));
  expect(container.querySelector("[data-chat]")?.getAttribute("data-chat")).toBe("t1");
  act(() => click(container.querySelector('[aria-label="Close One"]')));
  expect(container.querySelector("[data-chat]")?.getAttribute("data-chat")).toBe("t2");
  expect(JSON.parse(localStorage.getItem("studio.bot.bot_main.threads")!)).toEqual({ open: ["t2"], active: "t2" });
});

test("Info tab: profile, controls, check-ins, and activity whose rows open the Threads tab", async () => {
  state.data = {
    bot_get: { bot: { ...dot, role: "You are my chief of staff." }, run: { enabled: true, cadence: "weekdays", time: "08:00" } },
    bot_activity: { ...empty, needsYou: [{ ...thread("t1", "Approve deploy"), needsYou: true }] },
  };
  await show(<BotInfoTab />);
  expect(container.querySelector("h2")?.textContent).toBe("Dot");
  expect(container.textContent).toContain("You are my chief of staff.");
  expect(container.textContent).toContain("Morning brief");
  await act(async () => [...container.querySelectorAll("button")].find((each) => each.textContent?.startsWith("Approve deploy"))!.click());
  expect(state.openFixedTab).toHaveBeenCalledWith(expect.objectContaining({ target: { threadId: "t1" } }));
  await act(async () => button("Pause").click());
  expect(state.call).toHaveBeenCalledWith("bot_pause", { botId: "bot_main" });
});

test("shows the Bot's chat and status, and confirms Stop", async () => {
  state.data = {
    bot_get: { bot: { ...dot, name: "Chief of Staff" }, run: { enabled: true, cadence: "daily", time: "09:00" } },
    bot_activity: { ...empty, inProgress: [thread("t2", "Research flights")] },
  };
  await show(<BotHome />);
  expect(container.querySelector("[data-chat]")?.getAttribute("data-chat")).toBe("thr_bot");
  expect(container.querySelector("[data-testid=bot-status]")?.textContent).toBe("Working on 1 thread");
  act(() => button("Stop…").click());
  expect(container.textContent).toContain("the 1 running thread it started stop");
  await act(async () => click([...container.querySelectorAll("[role=dialog] button")].find((each) => each.textContent === "Stop")));
  expect(state.call).toHaveBeenCalledWith("bot_stop", { botId: "bot_main" });
});

test("Edit profile saves shape, color and role; Skills (Share/Delete) live under Advanced; Memory opens its page", async () => {
  vi.stubGlobal("confirm", () => true);
  state.data = {
    bot_get: { bot: { ...dot, memoryPageId: "pg_mem" }, run: null },
    bot_activity: empty,
    bot_skills: { skills: [{ name: "weekly-review", description: "Fridays: sum up the week", updatedAt: 1 }] },
  };
  act(() => root.render(<BotHome />));
  const { openAppPath } = await import("@bb-studio/kit/app");
  await act(async () => button("Memory").click());
  expect(openAppPath).toHaveBeenCalledWith("/plugins/studio/studio/pages/pg_mem");
  act(() => button("Skills…").click());
  expect(container.textContent).toContain("weekly-review");
  await act(async () => button("Share").click());
  expect(state.call).toHaveBeenCalledWith("bot_skill_share", { name: "weekly-review", botId: "bot_main" });
  await act(async () => button("Delete").click());
  expect(state.call).toHaveBeenCalledWith("bot_skill_delete", { name: "weekly-review", botId: "bot_main" });
  act(() => click(container.querySelector('[aria-label="Shape star"]')));
  act(() => click(container.querySelector('[aria-label="Color #e5484d"]')));
  const role = container.querySelector('textarea[aria-label="Role"]') as HTMLTextAreaElement;
  act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(role, "You are my chief of staff."); role.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => button("Save").click());
  expect(state.call).toHaveBeenCalledWith("bot_set", { shape: "star", color: "#e5484d", role: "You are my chief of staff.", botId: "bot_main" });
});

test("BB's thread view always shows the Bot's main thread", async () => {
  state.data = { bot_get: { bot: dot, run: null }, bot_activity: empty, bot_chain: { threadIds: ["thr_old", "thr_bot"] } };
  await show(<BotHome />);
  expect(container.querySelector("[data-chat]")?.getAttribute("data-chat")).toBe("thr_bot");
});

test("Check-ins offers presets, marks the current one, and applies one in a click", async () => {
  state.data = { bot_get: { bot: dot, run: { enabled: true, cadence: "weekdays", time: "08:00" } }, bot_activity: empty };
  await show(<BotHome />);
  act(() => button("Check-ins…").click());
  const presets = [...container.querySelectorAll('[role=radiogroup][aria-label="Check-in preset"] [role=radio]')];
  expect(presets.map((each) => each.getAttribute("aria-checked"))).toEqual(["true", "false", "false", "false"]);
  await act(async () => click(presets[1]));
  expect(state.call).toHaveBeenCalledWith("bot_checkin_preset", { preset: "evening", botId: "bot_main" });
});

const scout = { ...dot, id: "bot_scout", name: "Scout", avatar: "🛰️", threadId: "thr_scout", primary: false };

test("several Bots: the selected one (from the route) is expanded and scoped; another opens its page", async () => {
  const { openAppPath } = await import("@bb-studio/kit/app");
  state.pathname = "/plugins/studio/bot/bot_scout";
  state.data = { bot_list: { bots: [{ ...dot, primary: true }, scout] }, bot_get: { bot: scout, run: null }, bot_activity: empty };
  await show(<BotThreadList {...listProps} />);
  const nav = container.querySelector('nav[aria-label="Bots"]')!;
  expect(nav.querySelector("[data-testid=bot-main]")?.textContent).toContain("Scout");
  expect(state.inputs).toContainEqual(["bot_get", { botId: "bot_scout" }]);
  expect(state.inputs).toContainEqual(["bot_activity", { botId: "bot_scout" }]);
  expect(state.inputs).toContainEqual(["bot_runners", { botId: "bot_scout" }]);
  const other = nav.querySelector('[data-testid=bot-row][data-bot="bot_main"]')!;
  expect(other.textContent).toContain("Dot");
  act(() => click(other));
  expect(openAppPath).toHaveBeenCalledWith("/plugins/studio/bot");
  act(() => click(nav.querySelector("[data-testid=bot-main]")));
  expect(openAppPath).toHaveBeenCalledWith("/plugins/studio/bot/bot_scout");
  act(() => click(nav.querySelector("[data-testid=bot-new]")));
  expect(openAppPath).toHaveBeenCalledWith("/plugins/studio/bot/new");
  // The page and its Info tab act on the selected Bot.
  await show(<BotHome />);
  expect(container.querySelector("[data-chat]")?.getAttribute("data-chat")).toBe("thr_scout");
  await show(<BotInfoTab />);
  act(() => click(button("Pause")));
  expect(state.call).toHaveBeenCalledWith("bot_pause", { botId: "bot_scout" });
});

test("New bot: the create flow greets as a new bot and the first message makes a second one, then opens it", async () => {
  const { openAppPath } = await import("@bb-studio/kit/app");
  state.pathname = "/plugins/studio/bot/new";
  state.data = { bot_get: { bot: dot, run: null } };
  state.call.mockImplementation((async (method: string) => method === "bot_create" ? { bot: scout, run: null } : {}) as never);
  await show(<BotHome />);
  expect(container.textContent).toContain("I'm a new bot");
  await act(async () => click(container.querySelector('[aria-label="Send"]')));
  expect(state.call).toHaveBeenCalledWith("bot_create", expect.objectContaining({ name: "New bot", avatar: "🤖" }));
  expect(openAppPath).toHaveBeenCalledWith("/plugins/studio/bot/bot_scout", { replace: true });
  state.call.mockImplementation(async () => ({}));
});

test("the navigation row says New bot on the Bot page, which opens the create flow; other items are BB's", async () => {
  const { openAppPath } = await import("@bb-studio/kit/app");
  const Original = () => <div data-testid="bb-navigation">New thread</div>;
  await show(<BotNavigation isCompactViewport={false} experimental_Original={Original} />);
  const nav = container.querySelector("[data-testid=bot-navigation]")!;
  expect([...nav.querySelectorAll("button")].map((each) => each.textContent)).toEqual(["New bot", "Search", "Bot"]);
  expect(nav.textContent).not.toContain("New thread");
  expect(nav.querySelector('[data-item="studio/bot"]')?.getAttribute("aria-current")).toBe("page");
  act(() => click(button("New bot")));
  expect(openAppPath).toHaveBeenCalledWith("/plugins/studio/bot/new");
  act(() => click(button("Search")));
  expect(state.activate).toHaveBeenCalledWith("__bb__/search-threads", { openInSplit: false });
});

test("off the Bot page the navigation shows BB's own and puts BB's bundled provider back", async () => {
  state.pathname = "/threads/thr_1";
  const Original = () => <div data-testid="bb-navigation">New thread</div>;
  await show(<BotNavigation isCompactViewport={false} experimental_Original={Original} />);
  expect(container.querySelector("[data-testid=bb-navigation]")).not.toBeNull();
  expect(container.querySelector("[data-testid=bot-navigation]")).toBeNull();
  expect(state.setPref).toHaveBeenCalledWith({ key: "sidebar.navigationProvider", value: "navigation/navigation", expectedRevision: 1 });
});
