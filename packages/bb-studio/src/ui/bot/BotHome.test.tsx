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
  experimental_ProviderIcon: ({ provider }: { provider: { id: string } }) => React.createElement("i", { "data-logo": provider.id }),
  experimental_useProviders: () => ({ status: "ready", providers: [{ id: "claude", displayName: "Claude" }, { id: "codex", displayName: "Codex" }] }),
  // The picker shows its value; its buttons pick Sonnet (same provider) or Codex (another).
  experimental_ProviderModelPicker: ({ value, onChange }: { value: { providerId: string; model: string }; onChange(next: unknown): void }) => React.createElement("span", { "data-picker": `${value.providerId}/${value.model}` },
    React.createElement("button", { type: "button", onClick: () => onChange({ providerId: "claude", model: "sonnet", reasoningLevel: "high" }) }, "pick sonnet"),
    React.createElement("button", { type: "button", onClick: () => onChange({ providerId: "codex", model: "gpt-5", reasoningLevel: "high" }) }, "pick codex")),
  experimental_PermissionModePicker: ({ value }: { value: string }) => React.createElement("span", { "data-permission": value }),
}));
const sdk = { system: { uiPreferences: {
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

const { ActivityPanel, BOT_PATH, BotHome, BotRedirect } = await import("./BotHome");
const { BotInfoTab, BotThreadsTab } = await import("./BotTabs");
const { BotThreadList } = await import("./BotSidebar");
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
  await show(<BotInfoTab />);
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
