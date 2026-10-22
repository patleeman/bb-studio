// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  call: vi.fn(async () => ({})),
  toThread: vi.fn((_threadId: string) => {}),
  openThreadPanel: vi.fn((_options: unknown) => true),
  pathname: "/plugins/studio/studio/bot",
  prefs: { value: "studio/bot", revision: 1 },
  setPref: vi.fn(async (_args: unknown) => ({})),
  /** BB's threads: id → project (missing: gone). Empty: sdk.threads.get fails, as before it was mocked. */
  threads: {} as Record<string, string>,
  activate: vi.fn(),
  inputs: [] as [string, unknown][],
  toCompose: vi.fn(),
  archived: [] as string[],
  sidebarThreads: { status: "ready", threads: [] as unknown[], projects: [] as { id: string; name: string }[], sections: [], archivedPage: null } as Record<string, unknown>,
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
  useBbNavigate: () => ({ toThread: state.toThread, openThreadPanel: state.openThreadPanel, toCompose: state.toCompose }),
  useSdk: () => sdk,
  experimental_useSidebarThreads: () => state.sidebarThreads,
  experimental_ThreadActionsContextMenu: ({ children, requestRename, thread }: { children: React.ReactNode; requestRename(id: string): void; thread: { id: string } }) =>
    React.createElement("div", { "data-menu-for": thread.id }, children, React.createElement("button", { type: "button", "data-rename": thread.id, onClick: () => requestRename(thread.id) }, "rename")),
  experimental_ThreadActionsMenu: ({ trigger }: { trigger(props: object): React.ReactNode }) => trigger({}),
  experimental_useThreadActions: (thread: { id: string }) => [{ key: "bb--core/archive", pluginId: "bb--core", action: { label: "Archive", icon: "Archive", run: () => state.archived.push(thread.id) } }],
  useSidebarThreadShortcut: () => null,
  experimental_ProviderIcon: ({ provider }: { provider: { id: string } }) => React.createElement("i", { "data-logo": provider.id }),
  experimental_useProviders: () => ({ status: "ready", providers: [{ id: "claude", displayName: "Claude" }, { id: "codex", displayName: "Codex" }] }),
  // The picker shows its value; its buttons pick Sonnet (same provider) or Codex (another).
  experimental_ProviderModelPicker: ({ value, onChange }: { value: { providerId: string; model: string }; onChange(next: unknown): void }) => React.createElement("span", { "data-picker": `${value.providerId}/${value.model}` },
    React.createElement("button", { type: "button", onClick: () => onChange({ providerId: "claude", model: "sonnet", reasoningLevel: "high" }) }, "pick sonnet"),
    React.createElement("button", { type: "button", onClick: () => onChange({ providerId: "codex", model: "gpt-5", reasoningLevel: "high" }) }, "pick codex")),
  experimental_PermissionModePicker: ({ value }: { value: string }) => React.createElement("span", { "data-permission": value }),
}));
const sdk = { threads: { update: vi.fn(async (_args: unknown) => ({})), get: async ({ threadId }: { threadId: string }) => {
  if (!(threadId in state.threads)) throw new Error("Thread not found");
  return { id: threadId, projectId: state.threads[threadId], deletedAt: null };
} }, system: { uiPreferences: {
  list: async () => ({ preferences: { "sidebar.threadListProvider": state.prefs } }),
  set: (args: unknown) => state.setPref(args),
} } };
vi.mock("./Onboarding", () => ({
  Welcome: ({ first, look, onCreate }: { first: boolean; look: { shape: string }; onCreate(goal: string): void }) => React.createElement("div", { "data-shape": look.shape }, first ? "Meet your Bot" : "Make another Bot",
    React.createElement("button", { onClick: () => onCreate("Watch my PRs") }, "Create Bot")),
}));
vi.mock("../../kit/app/index", () => ({
  PageColumn: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
  StudioBar: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
  openAppPath: vi.fn(), usePathname: () => state.pathname, DANGER_BUTTON: "", GHOST_BUTTON: "", ICON_BUTTON: "", OUTLINE_BUTTON: "", PRIMARY_BUTTON: "",
}));
vi.mock("../../kit/ui/index", () => ({
  Icon: ({ name, className }: { name: string; className?: string }) => React.createElement("span", { "data-icon": name, className }),
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(" "),
  DropdownMenu: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => children,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => React.createElement("div", { role: "menu" }, children),
  DropdownMenuItem: ({ children, onSelect }: { children: React.ReactNode; onSelect(): void }) => React.createElement("button", { type: "button", role: "menuitem", onClick: onSelect }, children),
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => React.createElement("span", null, children),
  DropdownMenuSeparator: () => null,
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => React.createElement("input", props),
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => React.createElement("textarea", props),
  Dialog: ({ children }: { children: React.ReactNode }) => React.createElement("div", { role: "dialog" }, children),
  DialogContent: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
  DialogHeader: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
  DialogFooter: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
  DialogTitle: ({ children }: { children: React.ReactNode }) => React.createElement("h2", null, children),
  DialogDescription: ({ children }: { children: React.ReactNode }) => React.createElement("p", null, children),
}));

const { ActivityPanel, BOT_PATH } = await import("./BotHome");
const { BotInfoPanel, BotPanel } = await import("./BotTabs");
const { BotThreadList } = await import("./BotSidebar");
const { forgetListMode } = await import("./threadListSwitch");
const listProps = { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate: () => {}, searchQuery: "" };

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.call.mockClear();
  state.toThread.mockClear();
  state.openThreadPanel.mockClear();
  state.pathname = "/plugins/studio/studio/bot";
  state.setPref.mockClear();
  state.activate.mockClear();
  state.inputs = [];
  state.threads = {};
  state.prefs = { value: "studio/bot", revision: 1 };
  state.toCompose.mockClear();
  state.sidebarThreads = { status: "ready", threads: [], projects: [], sections: [], archivedPage: null };
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
const thread = (id: string, title: string) => ({ id, title, status: "idle", projectId: "p", updatedAt: Date.now(), relation: "started" as const, needsYou: false, parentId: null as string | null });
const empty = { needsYou: [], inProgress: [], waiting: [], scheduled: [], completed: [], latest: null };
const dot = { id: "bot_main", name: "Dot", avatar: "🟣", shape: "blob", color: "#5b8def", state: "active", threadId: "thr_bot", createdAt: 1, updatedAt: 1 };

test("with no Bot, the welcome's Create makes it with the setup and opens its chat", async () => {
  state.data = { bot_get: { bot: null, run: null } };
  state.call.mockImplementation((async (method: string) => method === "bot_create" ? { bot: { ...dot, name: "Chief of Staff" }, run: null } : {}) as never);
  await show(<BotPanel />);
  expect(container.textContent).toContain("Meet your Bot");
  await act(async () => button("Create Bot").click());
  expect(state.call).toHaveBeenCalledWith("bot_create", { name: "Chief of Staff", avatar: "🤖", shape: "blob", color: "#5b8def", setup: "Watch my PRs" });
  expect(state.toThread).toHaveBeenCalledWith("thr_bot");
  state.call.mockImplementation(async () => ({}));
});

test("the Bot page lives under the Studio panel", () => {
  expect(BOT_PATH).toBe("/plugins/studio/studio/bot");
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
    bot_automations: { automations: [{ id: "a1", kind: "checkin", name: "Inbox sweep", state: "active", schedule: { type: "interval" }, nextRunAt: null }] },
    bot_chain: { threadIds: ["thr_old", "thr_bot"], threads: [{ id: "thr_old", title: "Relay" }, { id: "thr_bot", title: "Dot" }] },
  };
  await show(<BotThreadList {...listProps} />);
  const nav = container.querySelector('nav[aria-label="Bots"]')!;
  expect(nav.querySelector("[data-testid=bot-main]")?.textContent).toContain("Dot");
  const groups = [...nav.querySelectorAll("section")].map((section) => section.getAttribute("aria-label"));
  expect(groups).toEqual(["Needs you", "Running", "Schedule", "Recent", "Earlier conversations"]);
  // The running child pulls its parent into Running and nests under it.
  const running = nav.querySelector('section[aria-label="Running"]')!;
  expect(running.querySelector('li > button[data-thread="t2"] + ul button[data-thread="t3"]')).not.toBeNull();
  expect(nav.querySelector('section[aria-label="Recent"]')?.textContent).toContain("Weekly digest");
  expect(nav.querySelector('section[aria-label="Schedule"]')?.textContent).toContain("Inbox sweep");
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

test("on the Studio panel the Bots list puts Studio's list back and shows a placeholder", async () => {
  state.pathname = "/plugins/studio/studio";
  state.data = { bot_get: { bot: dot, run: null } };
  await show(<BotThreadList {...listProps} />);
  expect(container.querySelector("nav")).toBeNull();
  expect(state.setPref).toHaveBeenCalledWith({ key: "sidebar.threadListProvider", value: "studio/studio-items", expectedRevision: 1 });
});

test("the Bots list shows on every other page, with every thread below it as a two-line row naming its project", async () => {
  state.pathname = "/plugins/pages/pages";
  state.data = { bot_get: { bot: dot, run: null }, bot_activity: { ...empty }, bot_listed_threads: { threadIds: ["thr_bot_side"] } };
  const row = (id: string, projectId: string, extra: Record<string, unknown> = {}) => ({
    id, projectId, parentThreadId: null, isHidden: false, isArchived: false, isPinned: false, pinSortKey: null, isUnread: false,
    hasPendingInteraction: false, indicator: "none", status: "idle", runtimeStatus: "idle", updatedAt: Date.now() - 3_600_000, latestAttentionAt: 0,
    href: `/projects/${projectId}/threads/${id}`, ...extra,
  });
  state.sidebarThreads = { status: "ready", sections: [], archivedPage: null,
    projects: [{ id: "proj_a", name: "Orbit" }, { id: "proj_b", name: "Garden" }],
    threads: [
      row("thr_old", "proj_a", { updatedAt: Date.now() - 86_400_000 * 2, createdAt: 300 }),
      row("thr_new", "proj_b", { hasPendingInteraction: true, createdAt: 100 }),
      row("thr_pin", "proj_a", { isPinned: true, pinSortKey: "a", updatedAt: 0 }),
      row("thr_child", "proj_a", { parentThreadId: "thr_old" }),
      row("thr_hidden", "proj_a", { isHidden: true }),
      row("thr_bot_side", "proj_a"),
    ] };
  await show(<BotThreadList {...listProps} />);
  expect(container.querySelector("nav[aria-label=Bots]")).not.toBeNull();
  const section = container.querySelector('[data-testid="threads-section"]')!;
  const rows = [...section.querySelectorAll("[data-sidebar-thread-id]")];
  expect(rows.map((each) => each.getAttribute("data-sidebar-thread-id"))).toEqual(["thr_pin", "thr_new", "thr_old"]);
  expect(rows.map((each) => each.querySelector("[data-thread-project]")?.textContent)).toEqual(["Orbit", "Garden", "Orbit"]);
  expect(rows[1]!.textContent).toContain("Needs you");
  expect(rows[2]!.textContent).toContain("2d");
  act(() => click(rows[2]));
  expect(state.toThread).toHaveBeenCalledWith("thr_old", undefined);
  expect(section.querySelector('button[aria-label="New thread"]')).toBeNull();
  // BB's thread menu wraps each row; its Rename edits the title in place.
  act(() => click(section.querySelector('[data-rename="thr_old"]')));
  const input = section.querySelector<HTMLInputElement>('input[aria-label="Thread title"]')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Renamed");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  expect(sdk.threads.update).toHaveBeenCalledWith({ threadId: "thr_old", title: "Renamed" });
  // Archive on hover runs BB's own Archive for that row, without opening it.
  state.toThread.mockClear();
  act(() => click(section.querySelector('button[aria-label^="Archive"]')));
  expect(state.archived).toEqual(["thr_pin"]);
  expect(state.toThread).not.toHaveBeenCalled();
  // Sort by creation, then group under project headings: the project leaves the rows.
  const item = (label: string) => [...section.querySelectorAll('[role="menuitem"]')].find((each) => each.textContent?.startsWith(label))!;
  act(() => click(item("Created")));
  expect([...section.querySelectorAll("[data-sidebar-thread-id]")].map((each) => each.getAttribute("data-sidebar-thread-id"))).toEqual(["thr_pin", "thr_old", "thr_new"]);
  act(() => click(item("Project")));
  expect([...section.querySelectorAll('[role="group"]')].map((each) => each.getAttribute("aria-label"))).toEqual(["Orbit", "Garden"]);
  expect(section.querySelector("[data-thread-project]")).toBeNull();
  expect(JSON.parse(localStorage.getItem("studio.threads.view")!)).toEqual({ sort: "created", group: "project" });
});

test("after a Bots list open the Bots list stays on any thread", async () => {
  state.data = { bot_get: { bot: dot, run: null }, bot_activity: { ...empty, completed: [thread("t4", "Spawned work")] } };
  await show(<BotThreadList {...listProps} />);
  act(() => click(container.querySelector('[data-thread="t4"]')));
  expect(state.toThread).toHaveBeenCalledWith("t4");
  state.pathname = "/threads/t4";
  await show(<BotThreadList {...listProps} activeThreadId="t4" />);
  expect(container.querySelector("nav")).not.toBeNull();
  expect(container.querySelector('[data-thread="t4"]')?.getAttribute("aria-current")).toBe("true");
  state.pathname = "/projects/proj_1/threads/thr_run";
  await show(<BotThreadList {...listProps} activeThreadId="thr_run" />);
  expect(container.querySelector("nav")).not.toBeNull();
  expect(state.call).not.toHaveBeenCalledWith("bot_thread_owner", expect.anything());
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
  await act(async () => button("Edit").click());
  expect((container.querySelector('input[aria-label="Bot name"]') as HTMLInputElement)?.value).toBe("Dot");
  expect((container.querySelector('textarea[aria-label="Description"]') as HTMLTextAreaElement)?.value).toBe("You are my chief of staff.");
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

test("Bot info keeps profile and history collapsed until asked, then saves profile edits inline", async () => {
  vi.stubGlobal("confirm", () => true);
  state.data = {
    bot_get: { bot: { ...dot, role: "Chief of staff.", memoryPageId: "pg_mem" }, run: null },
    bot_activity: empty,
    bot_avatar_history: { current: "img_1", previous: "img_0", images: [{ id: "img_1", url: "data:image/png;base64,AA==", mime: "image/png", source: "upload", prompt: null, provider: null, createdAt: 1 }] },
    bot_profile_changes: { changes: [{ id: "change_1", field: "role", reverts: null, actorName: "Dot", oldValue: "Assistant", newValue: "Chief of staff", oldImageUrl: null, newImageUrl: null, revertedAt: null, at: Date.now() }] },
    bot_skills: { skills: [{ name: "weekly-review", description: "Fridays: sum up the week", updatedAt: 1 }] },
  };
  await show(<BotPanel />);
  expect(container.querySelector('[data-testid="bot-profile-section"]')).not.toBeNull();
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(container.querySelector('input[aria-label="Bot name"]')).toBeNull();
  expect(container.querySelector('input[type="file"][accept*="image/png"]')).toBeNull();
  expect(container.textContent).toContain("Chief of staff.");
  expect(container.querySelector('[data-testid="bot-info-status"]')?.textContent).toContain("Idle");
  const history = button("Profile changes");
  expect(history.getAttribute("aria-expanded")).toBe("false");
  expect((container.querySelector('[data-testid="bot-profile-change"]')?.closest("#bot-profile-changes-content") as HTMLElement | null)?.hidden).toBe(true);
  await act(async () => history.click());
  expect(button("Profile changes").getAttribute("aria-expanded")).toBe("true");
  expect(container.textContent).toContain("Changed by Dot");
  await act(async () => button("Profile changes").click());
  const { openAppPath } = await import("../../kit/app/index");
  await act(async () => button("Memory").click());
  expect(openAppPath).toHaveBeenCalledWith("/plugins/studio/studio/pages/pg_mem");
  act(() => button("Skills…").click());
  expect(container.textContent).toContain("weekly-review");
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => button("Share").click());
  expect(state.call).toHaveBeenCalledWith("bot_skill_share", { name: "weekly-review", botId: "bot_main" });
  await act(async () => button("Delete").click());
  expect(state.call).toHaveBeenCalledWith("bot_skill_delete", { name: "weekly-review", botId: "bot_main" });
  await act(async () => button("Edit").click());
  expect(container.querySelector('input[type="file"][accept*="image/png"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="bot-avatar-revert"]')).not.toBeNull();
  await act(async () => click(container.querySelector('[data-testid="bot-avatar-revert"]')));
  expect(state.call).toHaveBeenCalledWith("bot_avatar_revert", { botId: "bot_main" });
  act(() => click(container.querySelector('[aria-label="Shape star"]')));
  act(() => click(container.querySelector('[aria-label="Color #e5484d"]')));
  const role = container.querySelector('textarea[aria-label="Description"]') as HTMLTextAreaElement;
  act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(role, "You are my chief of staff."); role.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => button("Save profile").click());
  expect(state.call).toHaveBeenCalledWith("bot_set", { shape: "star", color: "#e5484d", role: "You are my chief of staff.", botId: "bot_main" });
  expect(container.querySelector('input[aria-label="Bot name"]')).toBeNull();
  expect(button("Edit")).not.toBeNull();
});

test("Bot profile opens from its name or avatar, and Cancel and Escape close it with focus returned", async () => {
  state.data = { bot_get: { bot: { ...dot, role: "Chief of staff." }, run: null }, bot_activity: empty };
  await show(<BotPanel />);
  const avatar = container.querySelector('button[aria-label="Edit Dot avatar and profile"]') as HTMLButtonElement;
  const name = container.querySelector('button[aria-label="Edit Dot profile"]') as HTMLButtonElement;
  expect(avatar).not.toBeNull();
  expect(name).not.toBeNull();
  await act(async () => click(avatar));
  const input = container.querySelector('input[aria-label="Bot name"]') as HTMLInputElement;
  expect(document.activeElement).toBe(input);
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Temporary name"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => button("Cancel").click());
  expect(container.querySelector('input[aria-label="Bot name"]')).toBeNull();
  expect(document.activeElement).toBe(button("Edit"));
  expect(state.call).not.toHaveBeenCalledWith("bot_set", expect.anything());

  await act(async () => click(container.querySelector('button[aria-label="Edit Dot profile"]')));
  expect(container.querySelector('input[aria-label="Bot name"]')).not.toBeNull();
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(container.querySelector('input[aria-label="Bot name"]')).toBeNull();
  expect(document.activeElement).toBe(button("Edit"));
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
  await act(async () => button("Edit").click());
  expect((container.querySelector('input[aria-label="Bot name"]') as HTMLInputElement)?.value).toBe("Dot");
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(container.querySelector("[data-testid=bot-open-chat]")).toBeNull();
  await show(<BotInfoPanel threadId="t9" params={null} />);
  expect(container.querySelector("[data-testid=bot-open-chat]")).not.toBeNull();
  state.data = { bot_thread_owner: { botId: null } };
  await show(<BotInfoPanel threadId="t9" params={null} />);
  expect(container.textContent).toContain("Not a Bot thread.");
});

test("the thread header Bot info button opens the existing right-side panel for Bot threads only", async () => {
  const { BotInfoHeaderAction } = await import("./BotTabs");
  state.data = { bot_thread_owner: { botId: "bot_main" } };
  await show(<BotInfoHeaderAction threadId="thr_bot" projectId="proj_personal" isCompactViewport={false} />);
  const button = container.querySelector('[data-testid="bot-info-header"]') as HTMLButtonElement;
  expect(button.title).toBe("Bot info");
  act(() => button.click());
  expect(state.openThreadPanel).toHaveBeenLastCalledWith({ actionId: "bot-info", title: "Bot info" });

  state.data = { bot_thread_owner: { botId: null } };
  await show(<BotInfoHeaderAction threadId="thr_regular" projectId="proj_personal" isCompactViewport={false} />);
  expect(container.querySelector('[data-testid="bot-info-header"]')).toBeNull();
});

test("the cache header shows a Clock and time, turns amber near expiry, and dims cold or disabled states", async () => {
  const { BotCacheChip, cacheIndicator, cacheLabel } = await import("./BotCache");
  const now = Date.now();
  const warm = {
    botId: "bot_main", threadId: "thr_bot", state: "warm" as const, label: "Warm · 59m", warmUntil: now + 59 * 60_000,
    model: "model", contextTokens: 100_000,
    warming: { active: true, nextPingAt: null, reason: null, lastPingAt: null, lastCompactAt: null, compactAt: null },
    costs: { warmingPerHour: 0.01, coldSend: 0.4, warmSend: 0.04 }, banner: false,
    settings: { enabled: true, thresholdTokens: 100_000, idleHours: 3, compactBeforeExpiry: true },
  };
  expect(cacheLabel(warm, now)).toBe("Warm · 59m left");
  expect(cacheIndicator(warm, now)).toMatchObject({ text: "59m", label: "Prompt cache: 59m left", tone: "normal" });
  expect(cacheIndicator({ ...warm, warmUntil: now + 10 * 60_000 }, now).tone).toBe("normal");
  expect(cacheIndicator({ ...warm, warmUntil: now + 9 * 60_000 }, now).tone).toBe("amber");
  expect(cacheIndicator({ ...warm, warmUntil: now }, now)).toMatchObject({ text: "cold", tone: "dim" });
  expect(cacheLabel({ ...warm, state: "cold", label: "Cold", warmUntil: null }, now)).toBe("Cold");
  const off = { ...warm, state: "off" as const, label: "Warming off", warmUntil: null, settings: { ...warm.settings, enabled: false } };
  expect(cacheLabel(off, now)).toBe("Warming off");
  expect(cacheIndicator(off, now)).toMatchObject({ text: null, label: "Prompt cache: Warming off", tone: "dim" });
  state.data = { bot_cache_state: warm };
  await show(<BotCacheChip threadId="thr_bot" projectId="proj_personal" isCompactViewport={false} />);
  const chip = container.querySelector('[data-testid="bot-cache-chip"]') as HTMLButtonElement;
  expect(chip.title).toBe("Prompt cache: 59m left");
  expect(chip.getAttribute("aria-label")).toBe("Prompt cache: 59m left");
  expect(chip.textContent).toBe("59m");
  expect(chip.querySelector('[data-icon="Clock"]')).not.toBeNull();
  expect(container.querySelector('[role="menu"]')?.textContent).toContain("cold send ≈");
  expect(container.querySelector('[role="menu"]')?.textContent).toContain("warming ≈");

  state.data = { bot_cache_state: { ...warm, warmUntil: now } };
  await show(<BotCacheChip threadId="thr_bot" projectId="proj_personal" isCompactViewport={false} />);
  expect(chip.textContent).toBe("cold");
  expect((chip.querySelector('[data-icon="Clock"]') as HTMLElement).className).toContain("text-muted-foreground/40");

  state.data = { bot_cache_state: off };
  await show(<BotCacheChip threadId="thr_bot" projectId="proj_personal" isCompactViewport={false} />);
  expect(chip.textContent).toBe("");
  expect(chip.getAttribute("aria-label")).toBe("Prompt cache: Warming off");
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
  const { openAppPath } = await import("../../kit/app/index");
  state.pathname = "/plugins/studio/studio/bot/bot_scout";
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
  expect(openAppPath).toHaveBeenCalledWith("/plugins/studio/studio/bot/bot_main");
  act(() => click(nav.querySelector("[data-testid=bot-main]")));
  expect(state.toThread).toHaveBeenCalledWith("thr_scout");
  act(() => click(nav.querySelector('[aria-label="Open Scout info"]')));
  expect(openAppPath).toHaveBeenCalledWith("/plugins/studio/studio/bot/bot_scout");
  act(() => click(nav.querySelector("[data-testid=bot-new]")));
  expect(openAppPath).toHaveBeenCalledWith("/plugins/studio/studio/bot/new");
  // The page, its Info, acts on the selected Bot.
  await show(<BotPanel />);
  act(() => click(button("Pause")));
  expect(state.call).toHaveBeenCalledWith("bot_pause", { botId: "bot_scout" });
});

test("New bot: the welcome makes a second one, then opens its chat", async () => {
  state.pathname = "/plugins/studio/studio/bot/new";
  state.data = { bot_get: { bot: dot, run: null } };
  state.call.mockImplementation((async (method: string) => method === "bot_create" ? { bot: scout, run: null } : {}) as never);
  await show(<BotPanel />);
  expect(container.textContent).toContain("Make another Bot");
  await act(async () => button("Create Bot").click());
  expect(state.call).toHaveBeenCalledWith("bot_create", expect.objectContaining({ name: "New bot", avatar: "🤖", setup: "Watch my PRs" }));
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

test("an external bot shows its provider's logo and hides Memory, skills and runners with a note", async () => {
  const herm = { ...dot, id: "bot_h", name: "Herm", primary: false, kind: "external", providerId: "hermes", model: "hermes-agent" };
  state.pathname = "/plugins/studio/studio/bot/bot_h";
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

test("Skills: learn from work, the last review, history, pins and archived skills with Restore", async () => {
  state.data = {
    bot_get: { bot: dot, run: null },
    bot_activity: empty,
    bot_skills: { skills: [
      { name: "deploy-check", description: "Before a deploy", updatedAt: 1, state: "active", pinned: false, usedAt: 1 },
      { name: "inbox-sweep", description: "Sort mail", updatedAt: 1, state: "stale", pinned: true, usedAt: 1 },
      { name: "old-report", description: "Gone quiet", updatedAt: 1, state: "archived", pinned: false, usedAt: 1 },
    ] },
    bot_skill_history: { versions: [{ id: 1, name: "deploy-check", body: "new", diff: "- old\n+ new", warnings: ["Advisory lint warning"], at: 1 }] },
    bot_learning: {
      enabled: true, interval: 10, reviewModel: null, defaultModel: "claude-haiku-5-5", models: ["claude-opus-5-5", "claude-haiku-5-5"], consolidate: false,
      toolTurns: 3, userTurns: 1, reviewing: false, lastReview: { at: Date.now() - 2 * 3_600_000, result: "Saved 1 skill" }, lastCurator: null,
    },
  };
  await show(<BotPanel />);
  act(() => button("Skills…").click());
  expect(container.textContent).toContain("Saved 1 skill · 2h ago");
  expect(container.textContent).toContain("Cheapest (claude-haiku-5-5)");
  expect(container.textContent).toContain("stale");
  expect(container.textContent).toContain("- old\n+ new");
  expect(container.textContent).not.toContain("old-report");
  expect(container.textContent).not.toContain("Waiting for your approval");
  expect(container.textContent).toContain("Advisory lint warning");
  await act(async () => button("Revert").click());
  expect(state.call).toHaveBeenCalledWith("bot_skill_revert", { versionId: 1, botId: "bot_main" });
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
  state.pathname = "/plugins/studio/studio/bot/bot_main";
  state.data = { bot_get: { bot: dot, run: null }, bot_activity: empty };
  state.threads = { thr_bot: "proj_personal" };
  sessionStorage.setItem("studio.sidebar.lastBotThread", "thr_bot");
  await show(<BotPanel />);
  expect(state.toThread).not.toHaveBeenCalled();
  expect(container.querySelector("[data-testid=bot-info-status]")).not.toBeNull();
});

test("a thread dragged from Threads onto a bot's row moves under that bot", async () => {
  state.pathname = "/plugins/pages/pages";
  state.data = { bot_list: { bots: [{ ...dot, primary: true }, scout] }, bot_get: { bot: dot, run: null }, bot_activity: empty, bot_listed_threads: { threadIds: [] } };
  state.sidebarThreads = { status: "ready", sections: [], archivedPage: null, projects: [{ id: "proj_a", name: "Orbit" }], threads: [{
    id: "thr_mine", projectId: "proj_a", parentThreadId: null, isHidden: false, isArchived: false, isPinned: false, pinSortKey: null, isUnread: false,
    hasPendingInteraction: false, indicator: "none", status: "idle", runtimeStatus: "idle", updatedAt: Date.now(), latestAttentionAt: 0, href: "/projects/proj_a/threads/thr_mine",
  }] };
  await show(<BotThreadList {...listProps} />);
  // jsdom has no DataTransfer: a stand-in carries the row's data from dragstart to drop.
  const data = new Map<string, string>();
  const dataTransfer = { setData: (type: string, value: string) => data.set(type, value), getData: (type: string) => data.get(type) ?? "", get types() { return [...data.keys()]; }, effectAllowed: "", dropEffect: "" };
  const drag = (el: Element, type: string) => { const event = Object.assign(new Event(type, { bubbles: true, cancelable: true }), { dataTransfer }); el.dispatchEvent(event); return event; };
  const row = container.querySelector('[data-sidebar-thread-id="thr_mine"]')!;
  expect(row.getAttribute("draggable")).toBe("true");
  act(() => { drag(row, "dragstart"); });
  const target = container.querySelector('[data-testid=bot-row][data-bot="bot_scout"]')!.parentElement!;
  let over!: Event;
  act(() => { over = drag(target, "dragover"); });
  expect(over.defaultPrevented).toBe(true);
  expect(target.hasAttribute("data-drop-over")).toBe(true);
  await act(async () => { drag(target, "drop"); });
  expect(state.call).toHaveBeenCalledWith("bot_thread_adopt", { botId: "bot_scout", threadId: "thr_mine" });
  expect(target.hasAttribute("data-drop-over")).toBe(false);
});

test("a thread dragged from a bot's list onto Threads comes back; a Threads row dropped there does nothing", async () => {
  state.pathname = "/plugins/pages/pages";
  state.data = { bot_get: { bot: dot, run: null }, bot_activity: { ...empty, completed: [thread("thr_done", "Done work")] }, bot_listed_threads: { threadIds: [] } };
  await show(<BotThreadList {...listProps} />);
  const data = new Map<string, string>();
  const dataTransfer = { setData: (type: string, value: string) => data.set(type, value), getData: (type: string) => data.get(type) ?? "", get types() { return [...data.keys()]; }, effectAllowed: "", dropEffect: "" };
  const drag = (el: Element, type: string) => { const event = Object.assign(new Event(type, { bubbles: true, cancelable: true }), { dataTransfer }); el.dispatchEvent(event); return event; };
  const section = container.querySelector('[data-testid="threads-section"]')!;
  // Only a Bot's thread drops here.
  data.set("application/x-studio-thread", "thr_mine");
  expect(drag(section, "dragover").defaultPrevented).toBe(false);
  data.clear();
  act(() => { drag(container.querySelector('[data-thread="thr_done"]')!, "dragstart"); });
  let over!: Event;
  act(() => { over = drag(section, "dragover"); });
  expect(over.defaultPrevented).toBe(true);
  await act(async () => { drag(section, "drop"); });
  expect(state.call).toHaveBeenCalledWith("bot_thread_release", { threadId: "thr_done" });
});


test("adopts a suggested runner from maintenance without a confirmation dialog", async () => {
  const { BotMaintenance } = await import("./BotMaintenance");
  const { maintenanceDefaults } = await import("../../bot-maintenance");
  state.data = { bot_maintenance_get: { settings: maintenanceDefaults(), liveAt: null, runs: [{ at: Date.now(), dryRun: true, summary: "Dry run", actions: [], needsCall: [], suggestions: [{ text: "Consider Report as a runner", threadId: "thr_adopt", automationId: "auto1" }] }] } };
  await show(<BotMaintenance botId="bot_main" />);
  await act(async () => button("Adopt").click());
  expect(state.call).toHaveBeenCalledWith("bot_runner_adopt", { botId: "bot_main", threadId: "thr_adopt", automationId: "auto1" });
  expect(container.querySelector('[role="dialog"]')).toBeNull();
});

test("Recent hides old idle threads and Show archived reveals them in one click", async () => {
  const old = { ...thread("old", "Earlier job"), updatedAt: Date.now() - 8 * 86_400_000 };
  state.data = {
    bot_get: { bot: dot, run: null }, bot_chain: { threadIds: [dot.threadId] },
    bot_activity: { ...empty, completed: [old, thread("new", "Fresh job")], waiting: [{ ...old, id: "waiting", title: "Waiting job", status: "pending" }] },
    bot_maintenance_threads: { threads: [old, thread("archived", "Archived job")] },
  };
  await show(<BotThreadList {...listProps} />);
  expect(container.querySelector('section[aria-label="Recent"]')?.textContent).toContain("Fresh job");
  expect(container.textContent).not.toContain("Earlier job"); expect(container.textContent).toContain("Waiting job");
  act(() => button("Show archived").click());
  expect(container.textContent).toContain("Earlier job"); expect(container.textContent).toContain("Archived job");
  act(() => button("Hide archived").click()); expect(container.textContent).not.toContain("Earlier job");
});


test("the sidebar agenda sorts all Bot jobs, collapses done reminders, and opens runner threads from either section", async () => {
  const now = Date.now();
  const runner = { id: "security", name: "Dot · Security", threadId: "thr_security", providerId: "codex", state: "active", urgent: false,
    schedule: { cadence: "hourly", time: "09:00" }, nextRunAt: now + 120_000, lastRunAt: now - 60_000, lastReportAt: now - 60_000, lastLevel: "tell" };
  const automation = (id: string, kind: string, name: string, nextRunAt: number | null, status = "active") => ({ id, kind, name, nextRunAt, state: status, schedule: { type: "once" }, scheduleText: "Once" });
  state.data = {
    bot_get: { bot: dot, run: null }, bot_activity: empty, bot_runners: { runners: [runner], adoptable: [] },
    bot_automations: { automations: [automation("security", "runner", runner.name, runner.nextRunAt), automation("check", "checkin", "Dot · Check-in", now + 60_000),
      automation("watch", "watcher", "Scout · Watch", now + 180_000), automation("remind", "reminder", "Dot · Remind me", now + 90_000),
      automation("done", "reminder", "Dot · Finished", null, "done"), automation("off", "reminder", "Dot · Off", null, "paused"),
      automation("paused", "watcher", "Dot · Paused watch", null, "paused")] },
  };
  state.data.bot_activity = { ...empty, scheduled: [
    { id: "bb-inbox", kind: "automation", name: "Dot · Inbox sweep", cron: "0 * * * *", enabled: true, nextRunAt: now + 150_000 },
    { id: "bb-off", kind: "automation", name: "Dot · Off BB job", cron: "0 * * * *", enabled: false, nextRunAt: null },
  ] };
  await show(<BotThreadList {...listProps} />);
  const schedule = container.querySelector('section[aria-label="Schedule"]')!;
  const runners = container.querySelector('section[aria-label="Runners"]')!;
  expect([...schedule.querySelectorAll("[data-agenda]")].map(row => row.getAttribute("data-agenda"))).toEqual(["check", "remind", "security", "bb-inbox", "watch", "bb-off", "paused"]);
  expect(schedule.textContent).toContain("Inbox sweep");
  expect(schedule.querySelector('[data-agenda="bb-off"]')?.textContent).toContain("paused");
  expect(schedule.textContent).toContain("Check-in");
  expect(schedule.textContent).not.toContain("Dot · ");
  expect(schedule.textContent).toContain("Scout · Watch");
  expect(schedule.textContent).toContain("paused");
  expect(schedule.textContent).not.toContain("Finished");
  expect(button("2 done").getAttribute("aria-expanded")).toBe("false");
  act(() => button("2 done").click());
  expect(schedule.querySelector('[data-agenda="done"]')?.className).toContain("opacity-50");
  expect(schedule.querySelector('[data-agenda="off"]')?.textContent).toContain("paused");
  expect(runners.textContent).toContain("reported");
  expect(runners.textContent).not.toContain("Dot · ");
  expect(schedule.querySelector('[data-runner] [data-logo="codex"]')).not.toBeNull();
  expect(schedule.querySelector('[data-runner]')?.className).toContain("h-7");
  await act(async () => click(schedule.querySelector('[data-runner]')));
  expect(state.toThread).toHaveBeenCalledWith("thr_security");
  state.toThread.mockClear();
  await act(async () => click(runners.querySelector('[data-runner]')));
  expect(state.toThread).toHaveBeenCalledWith("thr_security");
  Object.assign(runner, { lastRunStatus: "failed" });
  await show(<BotThreadList {...listProps} />);
  expect(runners.querySelector(".text-destructive")?.textContent).toContain("failed");
});
