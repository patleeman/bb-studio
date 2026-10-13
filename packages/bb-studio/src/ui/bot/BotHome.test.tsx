// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  call: vi.fn(async () => ({})),
  toThread: vi.fn((_threadId: string) => {}),
  openThreadPanel: vi.fn((_options: unknown) => true),
  pathname: "/plugins/studio/bot",
  prefs: { value: "studio/bot", revision: 1 },
  setPref: vi.fn(async (_args: unknown) => ({})),
  /** BB's threads: id → project (missing: gone). Empty: sdk.threads.get fails, as before it was mocked. */
  threads: {} as Record<string, string>,
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
  ThreadTitle: ({ threadId }: { threadId: string }) => React.createElement("span", null, `title:${threadId}`),
  useBbNavigate: () => ({ toThread: state.toThread, openThreadPanel: state.openThreadPanel }),
  useSdk: () => sdk,
  experimental_ProviderIcon: ({ provider }: { provider: { id: string } }) => React.createElement("i", { "data-logo": provider.id }),
  experimental_useProviders: () => ({ status: "ready", providers: [{ id: "claude", displayName: "Claude" }, { id: "codex", displayName: "Codex" }] }),
  // The picker shows its value; its buttons pick Sonnet (same provider) or Codex (another).
  experimental_ProviderModelPicker: ({ value, onChange }: { value: { providerId: string; model: string }; onChange(next: unknown): void }) => React.createElement("span", { "data-picker": `${value.providerId}/${value.model}` },
    React.createElement("button", { type: "button", onClick: () => onChange({ providerId: "claude", model: "sonnet", reasoningLevel: "high" }) }, "pick sonnet"),
    React.createElement("button", { type: "button", onClick: () => onChange({ providerId: "codex", model: "gpt-5", reasoningLevel: "high" }) }, "pick codex")),
  experimental_PermissionModePicker: ({ value }: { value: string }) => React.createElement("span", { "data-permission": value }),
}));
const sdk = { threads: { get: async ({ threadId }: { threadId: string }) => {
  if (!(threadId in state.threads)) throw new Error("Thread not found");
  return { id: threadId, projectId: state.threads[threadId], deletedAt: null };
} }, system: { uiPreferences: {
  list: async () => ({ preferences: { "sidebar.threadListProvider": state.prefs } }),
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

const { ActivityPanel, BOT_PATH, BotRedirect } = await import("./BotHome");
const { BotInfoPanel, BotPanel } = await import("./BotTabs");
const { BotThreadList, ThreadListSwitcher } = await import("./BotSidebar");
const { forgetListMode } = await import("./threadListSwitch");
const listProps = { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate: () => {}, searchQuery: "" };

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.call.mockClear();
  state.toThread.mockClear();
  state.openThreadPanel.mockClear();
  state.pathname = "/plugins/studio/bot";
  state.setPref.mockClear();
  state.activate.mockClear();
  state.inputs = [];
  state.threads = {};
  localStorage.clear();
  sessionStorage.clear();
  forgetListMode();
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
  await show(<BotPanel />);
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

test("the Bots list: the bot on top, Needs you flat, started threads nested under the one that started them; a row opens the thread as a BB thread", async () => {
  state.data = {
    bot_get: { bot: dot, run: null },
    bot_activity: {
      ...empty,
      needsYou: [{ ...thread("t1", "Approve deploy"), needsYou: true }],
      inProgress: [{ ...thread("t3", "Fix flaky test"), status: "active", parentId: "t2" }],
      completed: [thread("t2", "Research CI"), thread("t4", "Weekly digest")],
      scheduled: [{ id: "a1", kind: "automation", name: "Inbox sweep", cron: "0 * * * *", enabled: true, nextRunAt: null }],
    },
    bot_chain: { threadIds: ["thr_old", "thr_bot"], threads: [{ id: "thr_old", title: "Relay" }, { id: "thr_bot", title: "Dot" }] },
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
  expect(nav.textContent).not.toContain("Relay");
  // Opened, each shows the title bot_chain read: chain threads are hidden, so BB's ThreadTitle has none.
  act(() => click(nav.querySelector('section[aria-label="Earlier conversations"] > button')));
  expect(nav.querySelector('section[aria-label="Earlier conversations"]')?.textContent).toContain("Relay");
  expect(nav.textContent).not.toContain("title:thr_old");
  act(() => click(nav.querySelector('section[aria-label="Earlier conversations"] > button')));
  await act(async () => click(nav.querySelector('[data-thread="t4"]')));
  expect(state.toThread).toHaveBeenCalledWith("t4");
  // The bot's row opens its chat as a BB thread, like its other threads.
  await act(async () => click(nav.querySelector("[data-testid=bot-main]")));
  expect(state.toThread).toHaveBeenCalledWith("thr_bot");
  // BB's active thread is marked.
  await show(<BotThreadList {...listProps} activeThreadId="t4" />);
  expect(container.querySelector('nav[aria-label="Bots"] [data-thread="t4"]')?.getAttribute("aria-current")).toBe("true");
  const nav2 = container.querySelector('nav[aria-label="Bots"]')!;
  // Closed groups are remembered.
  act(() => click(nav2.querySelector('section[aria-label="Recent"] > button')));
  expect(JSON.parse(localStorage.getItem("studio.bot.sidebar")!).closed).toContain("recent");
  // The Bot page is its Info, with what needs the user; no embedded chat.
  await show(<BotPanel />);
  expect(container.querySelector("nav")).toBeNull();
  expect(container.querySelector('section[aria-label="Needs you"]')?.textContent).toContain("Approve deploy");
});

test("off the Bot page the Bots list puts BB's list back and shows a placeholder", async () => {
  state.pathname = "/plugins/pages/pages";
  state.data = { bot_get: { bot: dot, run: null } };
  await show(<BotThreadList {...listProps} />);
  expect(container.querySelector("nav")).toBeNull();
  expect(state.setPref).toHaveBeenCalledWith({ key: "sidebar.threadListProvider", value: "thread-list/thread-list", expectedRevision: 1 });
});

test("a window with no mode, opened on a thread no Bot owns, asks once and puts BB's list back", async () => {
  state.pathname = "/threads/thr_1";
  state.call.mockImplementation((async (method: string) => method === "bot_thread_owner" ? { botId: null } : {}) as never);
  state.data = { bot_get: { bot: dot, run: null } };
  await show(<BotThreadList {...listProps} />);
  expect(state.call).toHaveBeenCalledWith("bot_thread_owner", { threadId: "thr_1" });
  expect(state.setPref).toHaveBeenCalledWith({ key: "sidebar.threadListProvider", value: "thread-list/thread-list", expectedRevision: 1 });
  expect(sessionStorage.getItem("studio.sidebar.listMode")).toBe("native");
  expect(container.querySelector("nav")).toBeNull();
  state.call.mockImplementation(async () => ({}));
});

test("after a Bots list open the Bots list stays on any thread, without asking who owns it", async () => {
  state.data = { bot_get: { bot: dot, run: null }, bot_activity: { ...empty, completed: [thread("t4", "Spawned work")] } };
  await show(<BotThreadList {...listProps} />);
  act(() => click(container.querySelector('[data-thread="t4"]')));
  expect(state.toThread).toHaveBeenCalledWith("t4");
  expect(sessionStorage.getItem("studio.sidebar.listMode")).toBe("bots");
  state.pathname = "/threads/t4";
  await show(<BotThreadList {...listProps} activeThreadId="t4" />);
  expect(container.querySelector("nav")).not.toBeNull();
  expect(container.querySelector('[data-thread="t4"]')?.getAttribute("aria-current")).toBe("true");
  // A runner in another project, reached any way: still the Bots list.
  state.pathname = "/projects/proj_1/threads/thr_run";
  await show(<BotThreadList {...listProps} activeThreadId="thr_run" />);
  expect(container.querySelector("nav")).not.toBeNull();
  expect(state.call).not.toHaveBeenCalledWith("bot_thread_owner", expect.anything());
  expect(state.setPref).not.toHaveBeenCalled();
});

test("Home on BB's rail leaves the Bots list, even on a thread where BB's Home doesn't navigate", async () => {
  sessionStorage.setItem("studio.sidebar.listMode", "bots");
  state.pathname = "/projects/proj_1/threads/thr_run";
  await show(<ThreadListSwitcher />);
  expect(state.setPref).not.toHaveBeenCalled();
  const rail = document.createElement("nav");
  rail.setAttribute("aria-label", "Primary navigation");
  rail.innerHTML = '<button type="button" aria-label="Home"><span>icon</span></button>';
  document.body.append(rail);
  await act(async () => { rail.querySelector("span")!.click(); });
  await act(async () => {});
  expect(sessionStorage.getItem("studio.sidebar.listMode")).toBe("native");
  expect(state.setPref).toHaveBeenCalledWith({ key: "sidebar.threadListProvider", value: "thread-list/thread-list", expectedRevision: 1 });
  rail.remove();
});

test("the Bots list forgets the removed Threads tab's saved strips", async () => {
  localStorage.setItem("studio.bot.bot_main.threads", '{"open":["t4"],"active":"t4"}');
  state.data = { bot_get: { bot: dot, run: null }, bot_activity: { ...empty } };
  await show(<BotThreadList {...listProps} />);
  expect(localStorage.getItem("studio.bot.bot_main.threads")).toBeNull();
});

test("Info tab: profile, controls, automations, and activity whose rows open as BB threads", async () => {
  state.data = {
    bot_get: { bot: { ...dot, role: "You are my chief of staff." }, run: { enabled: true, cadence: "weekdays", time: "08:00" } },
    bot_activity: { ...empty, needsYou: [{ ...thread("t1", "Approve deploy"), needsYou: true }] },
    bot_automations: { automations: [
      { id: "heartbeat", kind: "checkin", name: "Check-in", original: true, instruction: "Memory", schedule: { type: "times", days: [1, 2, 3, 4, 5], times: ["08:00"] }, scheduleText: "Weekdays 8:00", state: "active", nextRunAt: null, lastRunAt: null, lastOutcome: null, model: null, script: null, target: "main", targetName: "Dot", threadId: "thr_bot" },
      { id: "aut_w", kind: "watcher", name: "Release watch", original: false, instruction: "", schedule: { type: "interval", every: 15, unit: "minutes", days: [0, 1, 2, 3, 4, 5, 6] }, scheduleText: "Every 15 min, every day", state: "paused", nextRunAt: null, lastRunAt: null, lastOutcome: null, model: null, script: { body: "echo hi", interpreter: "bash", timeoutMs: 60000, workingDirectory: null, envKeys: [] }, target: "main", targetName: "Dot", threadId: "thr_bot" },
    ] },
  };
  await show(<BotPanel />);
  expect(container.querySelector("h2")?.textContent).toBe("Dot");
  expect(container.textContent).toContain("You are my chief of staff.");
  expect(container.querySelector("[data-automation=heartbeat]")?.textContent).toContain("Weekdays 8:00");
  expect(container.querySelector("[data-automation=aut_w]")?.textContent).toContain("Paused");
  await act(async () => [...container.querySelectorAll("button")].find((each) => each.textContent?.startsWith("Approve deploy"))!.click());
  expect(state.toThread).toHaveBeenCalledWith("t1");
  await act(async () => button("Pause").click());
  expect(state.call).toHaveBeenCalledWith("bot_pause", { botId: "bot_main" });
});

test("the Bot page shows its status and confirms Stop", async () => {
  state.data = {
    bot_get: { bot: { ...dot, name: "Chief of Staff" }, run: { enabled: true, cadence: "daily", time: "09:00" } },
    bot_activity: { ...empty, inProgress: [thread("t2", "Research flights")] },
  };
  await show(<BotPanel />);
  expect(container.querySelector("[data-testid=bot-info-status]")?.textContent).toBe("Working on 1 thread");
  act(() => button("Stop…").click());
  expect(container.textContent).toContain("the threads it started stop (not your own forks of its chat)");
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
  await show(<BotPanel />);
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

test("the Bot page embeds no chat; Open chat opens its main thread as a BB thread", async () => {
  state.data = { bot_get: { bot: dot, run: null }, bot_activity: empty, bot_chain: { threadIds: ["thr_old", "thr_bot"] } };
  await show(<BotPanel />);
  expect(container.querySelector('section[aria-label="Chat"]')).toBeNull();
  await act(async () => click(container.querySelector("[data-testid=bot-open-chat]")));
  expect(state.toThread).toHaveBeenCalledWith("thr_bot");
});

test("Bot info beside a thread: the owner's Info, no Open chat on its own chat; a thread no Bot owns says so", async () => {
  state.data = { bot_thread_owner: { botId: "bot_main" }, bot_get: { bot: dot, run: null }, bot_activity: empty };
  await show(<BotInfoPanel threadId="thr_bot" params={null} />);
  expect(state.inputs).toContainEqual(["bot_thread_owner", { threadId: "thr_bot" }]);
  expect(state.inputs).toContainEqual(["bot_get", { botId: "bot_main" }]);
  expect(container.querySelector("h2")?.textContent).toBe("Dot");
  expect(container.querySelector("[data-testid=bot-open-chat]")).toBeNull();
  await show(<BotInfoPanel threadId="t9" params={null} />);
  expect(container.querySelector("[data-testid=bot-open-chat]")).not.toBeNull();
  state.data = { bot_thread_owner: { botId: null } };
  await show(<BotInfoPanel threadId="t9" params={null} />);
  expect(container.textContent).toContain("Not a Bot thread.");
});

test("Check-ins offers presets, marks the current one, and applies one in a click", async () => {
  state.data = { bot_get: { bot: dot, run: { enabled: true, cadence: "weekdays", time: "08:00" } }, bot_activity: empty };
  await show(<BotPanel />);
  act(() => button("Check-ins…").click());
  const presets = [...container.querySelectorAll('[role=radiogroup][aria-label="Check-in preset"] [role=radio]')];
  expect(presets.map((each) => each.getAttribute("aria-checked"))).toEqual(["true", "false", "false", "false"]);
  await act(async () => click(presets[1]));
  expect(state.call).toHaveBeenCalledWith("bot_checkin_preset", { preset: "evening", botId: "bot_main" });
});

const scout = { ...dot, id: "bot_scout", name: "Scout", avatar: "🛰️", threadId: "thr_scout", primary: false };

test("several Bots: the selected one (from the route) is expanded and scoped; a row opens its chat, its ⓘ its Info", async () => {
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
  expect(state.toThread).toHaveBeenCalledWith("thr_bot");
  act(() => click(other.parentElement!.querySelector('[aria-label="Open Dot info"]')));
  // The primary's Info by id too: the bare Bot page opens the last Bot thread.
  expect(openAppPath).toHaveBeenCalledWith("/plugins/studio/bot/bot_main");
  act(() => click(nav.querySelector("[data-testid=bot-main]")));
  expect(state.toThread).toHaveBeenCalledWith("thr_scout");
  act(() => click(nav.querySelector('[aria-label="Open Scout info"]')));
  expect(openAppPath).toHaveBeenCalledWith("/plugins/studio/bot/bot_scout");
  act(() => click(nav.querySelector("[data-testid=bot-new]")));
  expect(openAppPath).toHaveBeenCalledWith("/plugins/studio/bot/new");
  // The page, its Info, acts on the selected Bot.
  await show(<BotPanel />);
  act(() => click(button("Pause")));
  expect(state.call).toHaveBeenCalledWith("bot_pause", { botId: "bot_scout" });
});

test("New bot: the create flow greets as a new bot and the first message makes a second one, then opens its chat", async () => {
  state.pathname = "/plugins/studio/bot/new";
  state.data = { bot_get: { bot: dot, run: null } };
  state.call.mockImplementation((async (method: string) => method === "bot_create" ? { bot: scout, run: null } : {}) as never);
  await show(<BotPanel />);
  expect(container.textContent).toContain("I'm a new bot");
  await act(async () => click(container.querySelector('[aria-label="Send"]')));
  expect(state.call).toHaveBeenCalledWith("bot_create", expect.objectContaining({ name: "New bot", avatar: "🤖" }));
  // Its chat opens as a BB thread.
  expect(state.toThread).toHaveBeenCalledWith("thr_scout");
  state.call.mockImplementation(async () => ({}));
});

test("on a Bot's thread the Bots list expands the thread's owner; its ⓘ opens Bot info beside the chat", async () => {
  state.pathname = "/threads/thr_s1";
  state.call.mockImplementation((async (method: string) => method === "bot_thread_owner" ? { botId: "bot_scout" } : {}) as never);
  state.data = { bot_list: { bots: [{ ...dot, primary: true }, scout] }, bot_thread_owner: { botId: "bot_scout" }, bot_get: { bot: scout, run: null }, bot_activity: empty };
  await show(<BotThreadList {...listProps} activeThreadId="thr_s1" />);
  expect(state.inputs).toContainEqual(["bot_thread_owner", { threadId: "thr_s1" }]);
  expect(state.inputs).toContainEqual(["bot_get", { botId: "bot_scout" }]);
  const nav = container.querySelector('nav[aria-label="Bots"]')!;
  expect(nav.querySelector("[data-testid=bot-main]")?.textContent).toContain("Scout");
  // Not its chat: Bot info doesn't open by itself.
  expect(state.openThreadPanel).not.toHaveBeenCalled();
  act(() => click(nav.querySelector('[aria-label="Open Scout info"]')));
  expect(state.openThreadPanel).toHaveBeenCalledWith({ actionId: "bot-info", title: "Bot info" });
  expect(sessionStorage.getItem("studio.bot.lastSelected")).toBe("bot_scout");
  state.call.mockImplementation(async () => ({}));
});

test("Bot info opens beside a Bot's chat once each time the chat opens, not again while it stays open", async () => {
  state.pathname = "/threads/thr_scout";
  state.call.mockImplementation((async (method: string) => method === "bot_thread_owner" ? { botId: "bot_scout" } : {}) as never);
  state.data = { bot_list: { bots: [scout] }, bot_thread_owner: { botId: "bot_scout" }, bot_get: { bot: scout, run: null }, bot_activity: empty, bot_chain: { threadIds: ["thr_old", "thr_scout"] } };
  await show(<BotThreadList {...listProps} activeThreadId="thr_scout" />);
  expect(state.openThreadPanel).toHaveBeenCalledTimes(1);
  expect(state.openThreadPanel).toHaveBeenCalledWith({ actionId: "bot-info", title: "Bot info" });
  // The user closes it; the list re-renders on the same chat: it stays closed.
  await show(<BotThreadList {...listProps} activeThreadId="thr_scout" searchQuery="x" />);
  expect(state.openThreadPanel).toHaveBeenCalledTimes(1);
  // Another thread, then an earlier conversation of the chain: it opens again.
  state.pathname = "/threads/thr_s1";
  await show(<BotThreadList {...listProps} activeThreadId="thr_s1" />);
  expect(state.openThreadPanel).toHaveBeenCalledTimes(1);
  state.pathname = "/threads/thr_old";
  await show(<BotThreadList {...listProps} activeThreadId="thr_old" />);
  expect(state.openThreadPanel).toHaveBeenCalledTimes(2);
  state.call.mockImplementation(async () => ({}));
});

const providers = { installed: true, providers: [
  { id: "hermes", displayName: "Hermes", logoUrl: null, status: "ready", message: "ok", models: [{ id: "hermes-agent", displayName: "hermes-agent", isDefault: true }], permissionModes: ["accept-edits", "full"] },
  { id: "openclaw", displayName: "OpenClaw", logoUrl: null, status: "disabled", message: "OpenClaw is off. Turn it on in Studio Agents settings.", models: [] },
  { id: "grok", displayName: "Grok", logoUrl: null, status: "ready", message: "ok", models: [{ id: "grok-4", displayName: "grok-4", isDefault: true }, { id: "grok-3", displayName: "grok-3", isDefault: false }], permissionModes: ["full"] },
] };

test("Import bot: picks a ready provider and model, shows the rest as not configured, and creates an external bot", async () => {
  state.data = { bot_get: { bot: dot, run: null }, bot_external_providers: providers };
  state.call.mockImplementation((async () => ({ bot: { ...dot, id: "bot_g", primary: false } })) as never);
  await show(<BotThreadList {...listProps} />);
  await act(async () => click(container.querySelector('[data-testid="bot-import"]')));
  const radio = (id: string) => container.querySelector(`[data-provider="${id}"][role="radio"]`) as HTMLButtonElement;
  expect(radio("hermes").getAttribute("aria-checked")).toBe("true");
  // Hermes takes accept edits (the default) or full access.
  expect((container.querySelector('select[aria-label="Permissions"]') as HTMLSelectElement).value).toBe("accept-edits");
  expect(radio("openclaw").disabled).toBe(true);
  expect(radio("openclaw").textContent).toContain("Not configured");
  await act(async () => click(radio("grok")));
  const model = container.querySelector('select[aria-label="Model"]') as HTMLSelectElement;
  expect(model.value).toBe("grok-4");
  expect((container.querySelector('input[aria-label="Bot name"]') as HTMLInputElement).value).toBe("Grok");
  await act(async () => button("Import").click());
  expect(state.call).toHaveBeenCalledWith("bot_create", expect.objectContaining({ name: "Grok", external: { providerId: "grok", model: "grok-4", permissionMode: "full" } }));
  state.call.mockImplementation((async () => ({})) as never);
});

test("Import bot links to Studio Agents settings when no provider is ready", async () => {
  state.data = { bot_get: { bot: dot, run: null }, bot_external_providers: { installed: true, providers: providers.providers.map((each) => ({ ...each, status: "disabled", models: [] })) } };
  await show(<BotThreadList {...listProps} />);
  await act(async () => click(container.querySelector('[data-testid="bot-import"]')));
  expect(button("Import").disabled).toBe(true);
  const { openAppPath } = await import("@bb-studio/kit/app");
  act(() => button("Set up a provider in Studio Agents settings").click());
  expect(openAppPath).toHaveBeenCalledWith("/settings/plugins/external-agents");
});

test("an external bot shows its provider's logo and hides Memory, skills and runners with a note", async () => {
  const herm = { ...dot, id: "bot_h", name: "Herm", primary: false, kind: "external", providerId: "hermes", model: "hermes-agent" };
  state.pathname = "/plugins/studio/bot/bot_h";
  state.data = { bot_get: { bot: herm, run: null }, bot_activity: empty };
  await show(<BotPanel />);
  expect(container.querySelector('[data-logo="hermes"]')).not.toBeNull();
  expect(container.textContent).toContain("Runs on Hermes — its memory and tools live there.");
  expect(container.textContent).toContain("hermes-agent");
  expect(button("Open")).toBeUndefined();
  expect(container.textContent).not.toContain("Procedures it saved");
});

test("Switch model hands off to another provider, saying so, and switches in place within one", async () => {
  const { modelChangeKind, pendingLabel } = await import("./BotModel");
  expect(modelChangeKind({ providerId: "claude", model: "opus" }, { providerId: "claude", model: "sonnet", reasoningLevel: "high" })).toBe("in-place");
  expect(modelChangeKind({ providerId: "claude", model: "opus" }, { providerId: "codex", model: "gpt-5", reasoningLevel: "high" })).toBe("handoff");
  expect(modelChangeKind({ providerId: "claude", model: "opus" }, { providerId: "claude", model: "opus", reasoningLevel: "high" })).toBe("unchanged");
  expect(pendingLabel("handoff", "Codex", "gpt-5")).toBe("Handing off to Codex…");
  const { SwitchModelDialog } = await import("./BotModel");
  let finish: (value: unknown) => void = () => {};
  state.call.mockImplementation((() => new Promise((resolve) => { finish = resolve; })) as never);
  const switched = vi.fn();
  await show(<SwitchModelDialog threadId="t1" providerId="claude" model="opus" onClose={() => {}} onSwitched={switched} />);
  expect(container.querySelector('[data-picker="claude/opus"]')).not.toBeNull();
  await act(async () => button("pick codex").click());
  await act(async () => button("Hand off to Codex").click());
  expect(state.call).toHaveBeenCalledWith("thread_handoff_to_model", { threadId: "t1", providerId: "codex", model: "gpt-5", reasoning: "high" });
  expect(container.querySelector('[data-testid="switch-model-pending"]')!.textContent).toBe("Handing off to Codex…");
  await act(async () => finish({ change: "handoff", threadId: "t2" }));
  expect(switched).toHaveBeenCalledWith("t2");
  state.call.mockImplementation((async () => ({})) as never);
});

test("Skills: learn from work, the last review, approvals, pins and archived skills with Restore", async () => {
  state.data = {
    bot_get: { bot: dot, run: null },
    bot_activity: empty,
    bot_skills: { skills: [
      { name: "deploy-check", description: "Before a deploy", updatedAt: 1, state: "active", pinned: false, usedAt: 1 },
      { name: "inbox-sweep", description: "Sort mail", updatedAt: 1, state: "stale", pinned: true, usedAt: 1 },
      { name: "old-report", description: "Gone quiet", updatedAt: 1, state: "archived", pinned: false, usedAt: 1 },
    ] },
    bot_learning: {
      enabled: true, interval: 10, reviewModel: null, defaultModel: "claude-haiku-5-5", models: ["claude-opus-5-5", "claude-haiku-5-5"], approval: true, consolidate: false, curatorPaused: false,
      toolTurns: 3, userTurns: 1, reviewing: false, lastReview: { at: Date.now() - 2 * 3_600_000, result: "Saved 1 skill" }, lastCurator: null, nextCuratorAt: null,
      pending: [{ id: "pend_1", name: "deploy-check", action: "write", description: "Before a deploy", diff: "- old\n+ new", createdAt: 1 }],
    },
  };
  await show(<BotPanel />);
  act(() => button("Skills…").click());
  expect(container.textContent).toContain("Saved 1 skill · 2h ago");
  expect(container.textContent).toContain("Cheapest (claude-haiku-5-5)");
  expect(container.textContent).toContain("stale");
  expect(container.textContent).toContain("- old\n+ new");
  expect(container.textContent).not.toContain("old-report");
  await act(async () => button("Approve").click());
  expect(state.call).toHaveBeenCalledWith("bot_skill_pending_resolve", { id: "pend_1", approve: true, botId: "bot_main" });
  await act(async () => click(container.querySelector('[aria-label="Pin deploy-check"]')));
  expect(state.call).toHaveBeenCalledWith("bot_skill_pin", { name: "deploy-check", pinned: true, botId: "bot_main" });
  act(() => button("Archived (1)").click());
  await act(async () => button("Restore").click());
  expect(state.call).toHaveBeenCalledWith("bot_skill_restore", { name: "old-report", botId: "bot_main" });
  await act(async () => click(container.querySelector('input[aria-label="Learn from work"]')));
  expect(state.call).toHaveBeenCalledWith("bot_learning_set", { enabled: false, botId: "bot_main" });
});

test("the bare Bot page (the rail's Bot item) opens this window's last Bot thread, keeping the Bots list", async () => {
  state.data = { bot_get: { bot: dot, run: null }, bot_activity: empty };
  state.threads = { thr_bot: "proj_personal", thr_runner: "proj_orbit" };
  sessionStorage.setItem("studio.sidebar.lastBotThread", "thr_runner");
  const replace = vi.spyOn(window.history, "replaceState");
  await show(<BotPanel />);
  expect(state.toThread).toHaveBeenCalledWith("thr_runner");
  expect(state.toThread).toHaveBeenCalledTimes(1);
  // The Bot page's history entry becomes the thread's, so Back doesn't land here and redirect again.
  expect(replace.mock.calls.map((call) => call[2])).toContain("/projects/proj_orbit/threads/thr_runner");
  expect(sessionStorage.getItem("studio.sidebar.listMode")).toBe("bots");
  expect(container.querySelector("[data-testid=bot-info-status]")).toBeNull();
  replace.mockRestore();
});

test("the bare Bot page falls back to the Bot's chat when the last thread is gone, and to Info with no thread", async () => {
  state.data = { bot_get: { bot: dot, run: null }, bot_activity: empty };
  state.threads = { thr_bot: "proj_personal" };
  sessionStorage.setItem("studio.sidebar.lastBotThread", "thr_deleted");
  await show(<BotPanel />);
  expect(state.toThread).toHaveBeenCalledWith("thr_bot");
  act(() => root.unmount());
  root = createRoot(container);
  state.toThread.mockClear();
  state.data = { bot_get: { bot: { ...dot, threadId: null }, run: null }, bot_activity: empty };
  sessionStorage.removeItem("studio.sidebar.lastBotThread");
  await show(<BotPanel />);
  expect(state.toThread).not.toHaveBeenCalled();
  expect(container.querySelector("[data-testid=bot-info-status]")).not.toBeNull();
});

test("a Bot's Info by id (its ⓘ, Bot info) isn't redirected", async () => {
  state.pathname = "/plugins/studio/bot/bot_main";
  state.data = { bot_get: { bot: dot, run: null }, bot_activity: empty };
  state.threads = { thr_bot: "proj_personal" };
  sessionStorage.setItem("studio.sidebar.lastBotThread", "thr_bot");
  await show(<BotPanel />);
  expect(state.toThread).not.toHaveBeenCalled();
  expect(container.querySelector("[data-testid=bot-info-status]")).not.toBeNull();
});
