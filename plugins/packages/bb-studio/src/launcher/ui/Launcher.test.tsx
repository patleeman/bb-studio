// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  openLink: vi.fn(async (_link: unknown, _options: unknown) => ({ via: "relay", how: "workbench" })),
  rpc: vi.fn(async (_method: string, _input: unknown): Promise<unknown> => null),
  client: null as unknown,
  windows: { native: true, register: vi.fn(async () => true), open: vi.fn(async (_id: string, _options?: object) => true), toggle: vi.fn(async () => true), close: vi.fn(async (_id: string) => true) },
  settings: { launcherHotkey: "Alt+Space" } as Record<string, unknown>,
  set: vi.fn(async (_patch: Record<string, unknown>) => {}),
  items: [] as { key: string; pluginId: string; id: string; title: string; icon: string; section: "apps" | "actions"; keywords?: string[]; order?: number; run: () => void | Promise<void> }[],
  commands: [] as { id: string; title: string; group: string; shortcut?: string; run: () => void }[],
}));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useRpc: () => (state.client ??= { call: (method: string, input: unknown) => state.rpc(method, input) }),
  useRealtime: () => {},
  experimental_Icon: () => null,
  experimental_useLauncherItems: () => state.items,
  experimental_useAppCommands: () => state.commands,
}));
vi.mock("../../presence/ui/BotFace", () => ({ BotFace: ({ botId }: { botId: string }) => <i data-testid="ask-face" data-face={botId} /> }));
vi.mock("../../kit/app/windows", async (original) => ({ ...(await original<typeof import("../../kit/app/windows")>()), hasHostWindows: true, useHostWindows: () => state.windows }));
vi.mock("../../links/open", () => ({ LinksBridge: () => null, useOpenLink: () => state.openLink }));
vi.mock("../../settings/ui/use-settings", () => ({ useStudioSettings: () => ({ values: state.settings, set: state.set }) }));
vi.mock("../../kit/ui/index", () => ({ Icon: () => null, cn: (...parts: unknown[]) => parts.filter(Boolean).join(" ") }));
vi.mock("../../ui/create-menu", () => ({ createEntries: () => [{ type: "kind", kind: { id: "page" } }], runCreateEntry: async (_entry: unknown, { rpc, open }: { rpc: { call(method: string, input: unknown): Promise<unknown> }; open(href: string): void }) => { await rpc.call("create", { kind: "page" }); open("/plugins/pages/pages/pg_new"); } }));
vi.mock("../../ui/new-menu", () => ({ entryFor: (_kind: string, entries: unknown[]) => entries[0] ?? null }));
vi.mock("../../ui/kinds-snapshot", () => ({ appliedKinds: () => null }));

import { registerLauncherItems, STUDIO_LAUNCHER_ITEMS } from "../items";
import { LAUNCHER_WINDOW_ID } from "../shared";
import { LauncherWindow } from "./Launcher";

let root: Root;
let host: HTMLDivElement;
const visualChat = vi.fn();
const $ = (selector: string) => host.querySelector<HTMLElement>(selector);
const rows = () => [...host.querySelectorAll<HTMLElement>('[data-testid="launcher-row"]')];
const titles = () => rows().map((row) => row.querySelector('[data-testid="launcher-title"]')?.textContent);
const sections = () => [...host.querySelectorAll('[data-testid="launcher-section"]')].map((label) => label.textContent);
const selected = () => rows().findIndex((row) => row.getAttribute("aria-selected") === "true");
const calls = (method: string) => state.rpc.mock.calls.filter(([name]) => name === method).map(([, input]) => input);
const input = () => $("input") as HTMLInputElement;

async function type(text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), text);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 160)); });
}
async function press(key: string, init: KeyboardEventInit = {}) {
  await act(async () => { input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })); });
  await act(async () => {});
}
async function mount() {
  window.history.replaceState({}, "", `/fork-window/studio/${LAUNCHER_WINDOW_ID}`);
  await act(async () => { root.render(<LauncherWindow />); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
}

const conversation = (id: string, title: string, updatedAt: number) => ({ id: `conversation:${id}`, title, kind: "Conversation", icon: "MessageSquare", updatedAt, ref: { kind: "conversation", id } });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state.settings = { launcherHotkey: "Alt+Space", loopsEnabled: false };
  state.set.mockClear();
  state.openLink.mockClear();
  state.items = [];
  registerLauncherItems({ experimental_launcherItem: (item: (typeof STUDIO_LAUNCHER_ITEMS)[number]) => { state.items.push({ ...item, keywords: [...(item.keywords ?? [])], key: `studio/${item.id}`, pluginId: "studio" }); } });
  visualChat.mockReset();
  state.items.push({ key: "visual-chat/app", pluginId: "visual-chat", id: "app", title: "Visual Chat", icon: "MessageCircle", section: "apps", order: 30, run: visualChat });
  state.commands = [{ id: "app:window.new", title: "New window", group: "Window and layout", shortcut: "⇧⌘N", run: vi.fn() }, { id: "app:thread.new", title: "New conversation", group: "Threads", shortcut: "⌘N", run: vi.fn() }];
  state.rpc.mockReset().mockImplementation(async (method: string, body: unknown) => {
    if (method === "newtab_recents") return { entries: [conversation("thr_1", "Fix the build", 30), { id: "page:pg_1", title: "Roadmap", kind: "Page", icon: "FileText", updatedAt: 25, ref: { kind: "page", id: "pg_1" } }, conversation("thr_2", "Plan the offsite", 20)] };
    if (method === "newtab_search") return { entries: [] };
    if (method === "bot_ask") return { threadId: (body as { to: { kind: string } }).to.kind === "new" ? "thr_new" : "thr_home", projectId: "proj_personal" };
    if (method === "overview") return { providers: [] };
    if (method === "bot_landing") { const { botId, last } = (body ?? {}) as { botId: string; last: string | null }; return { threadId: last && last !== "thr_gone" ? last : ({ bot_1: "thr_main", bot_2: "thr_home" } as Record<string, string>)[botId] ?? null }; }
    if (method === "bot_spaces") return { bots: [{ id: "bot_1", name: "Dot", mainThreadId: "thr_main" }, { id: "bot_2", name: "Home", mainThreadId: "thr_home" }], currentBotId: "bot_2" };
    if (method === "searchAll") {
      const { query } = body as { query: string };
      return query ? [{ ref: { pluginId: "pages", id: "pg_9" }, kind: "page", title: "Offsite budget", href: "/plugins/pages/pages/pg_9", updatedAt: 5 }] : [];
    }
    return { ok: true };
  });
  for (const each of [state.windows.open, state.windows.close]) each.mockClear();
  localStorage.clear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

it("opens on the search field with apps, actions, the recent conversations and files, then BB's commands and Studio's settings", async () => {
  await mount();
  expect(document.activeElement).toBe(input());
  expect(titles().slice(0, 10)).toEqual(["BB Studio", "Visual Chat", "VS Code", "New conversation", "Ask the Bot", "New page", "Switch to Dot", "Fix the build", "Roadmap", "Plan the offsite"]);
  expect(titles()[10]).toBe("New window");
  expect(titles().some((title) => /hud/i.test(title ?? ""))).toBe(false);
  expect(titles()).not.toContain("Switch to Home");
  expect(titles().filter((title) => title === "New conversation")).toHaveLength(1);
  expect(sections()).toEqual(["Apps", "Actions", "Recent", "Commands", "Settings"]);
  expect([...host.querySelectorAll('[data-testid="launcher-pick"]')].map((hint) => hint.textContent)).toEqual(["⌘1", "⌘2", "⌘3", "⌘4", "⌘5", "⌘6", "⌘7", "⌘8", "⌘9"]);
  expect(selected()).toBe(0);
  expect($("[data-studio-launcher]")?.className).toContain("bg-background");
  expect(calls("newtab_recents")).toEqual([{ threadId: null }]);
});

it("moves with the arrows and Tab, Enter runs the row, then closes the launcher", async () => {
  await mount();
  await press("ArrowDown");
  await press("ArrowDown");
  expect(selected()).toBe(2);
  await press("Tab");
  expect(selected()).toBe(3);
  await press("Tab", { shiftKey: true });
  expect(selected()).toBe(0);
  await press("ArrowDown");
  await press("Enter");
  expect(visualChat).toHaveBeenCalledTimes(1);
  expect(state.windows.close).toHaveBeenCalledWith(LAUNCHER_WINDOW_ID);
});

it("⌘ and a number runs that row: another plugin's app, a conversation in the main window", async () => {
  await mount();
  await press("2", { metaKey: true });
  expect(visualChat).toHaveBeenCalledTimes(1);
  expect(state.windows.close).toHaveBeenCalledWith(LAUNCHER_WINDOW_ID);
  await press("8", { metaKey: true });
  expect(state.openLink).toHaveBeenCalledWith("bb://conversation/thr_1", { source: "launcher", title: "Fix the build", modifiers: { meta: false, shift: false } });
});

it("Studio's rows open the main window where they say: the start, VS Code, the current Bot's Main, a new page, another Bot", async () => {
  await mount();
  for (const pick of ["1", "3", "4", "5", "6", "7"]) {
    await press(pick, { metaKey: true });
    await act(async () => {});
  }
  expect(calls("window.openInMain")).toEqual([
    { path: "/" }, { path: "/plugins/studio/vscode?studioRun=vscode" }, { path: "/" },
    { path: "/threads/thr_home" }, { path: "/plugins/pages/pages/pg_new" }, { path: "/threads/thr_main" },
  ]);
  expect(calls("create")).toEqual([{ kind: "page" }]);
  expect(calls("bot_focus")).toEqual([{ botId: "bot_1" }]);
});

it("filters as you type, finds documents through Studio's search, and Esc clears before it closes", async () => {
  await mount();
  await type("offsite");
  expect(calls("searchAll").at(-1)).toMatchObject({ query: "offsite" });
  expect(calls("newtab_search").at(-1)).toMatchObject({ query: "offsite", threadId: null });
  expect(titles()).toEqual(["Offsite budget", "Plan the offsite", "Ask Home: “offsite”"]);
  await press("Enter");
  expect(state.openLink).toHaveBeenCalledWith("bb://page/pg_9", { source: "launcher", title: "Offsite budget", modifiers: { meta: false, shift: false } });
  await press("Enter", { shiftKey: true });
  expect(state.openLink).toHaveBeenLastCalledWith("bb://page/pg_9", { source: "launcher", title: "Offsite budget", modifiers: { meta: false, shift: true } });
  state.windows.close.mockClear();
  await press("Escape");
  expect(input().value).toBe("");
  expect(state.windows.close).not.toHaveBeenCalled();
  expect(titles()[0]).toBe("BB Studio");
  await press("Escape");
  expect(state.windows.close).toHaveBeenCalledWith(LAUNCHER_WINDOW_ID);
});

it("a sentence is sent to the current Bot's Main on Enter, and BB's main window shows it", async () => {
  await mount();
  await type("what should I do next");
  expect(titles()[0]).toBe("Ask Home: “what should I do next”");
  expect(selected()).toBe(0);
  await press("Enter");
  expect(calls("bot_ask")).toEqual([{ text: "what should I do next", to: { kind: "thread", threadId: "thr_home" } }]);
  expect(state.windows.open).not.toHaveBeenCalled();
  expect(calls("window.openInMain")).toEqual([{ path: "/threads/thr_home" }]);
  expect(state.windows.close).toHaveBeenCalledWith(LAUNCHER_WINDOW_ID);
});

it("Shift+Enter on Ask starts a new conversation of the Bot with it", async () => {
  await mount();
  await type("plan the offsite agenda");
  await press("Enter", { shiftKey: true });
  expect(calls("bot_ask")).toEqual([{ text: "plan the offsite agenda", to: { kind: "new", botId: "bot_2" } }]);
  expect(calls("window.openInMain")).toEqual([{ path: "/threads/thr_new" }]);
});

it("runs BB's commands, typed addresses and setting toggles where they belong", async () => {
  await mount();
  await type("new window");
  expect(titles()[0]).toBe("New window");
  await press("Enter");
  expect(calls("window.runInMain")).toEqual([{ kind: "command", commandId: "app:window.new" }]);
  expect(state.commands[0]!.run).not.toHaveBeenCalled();
  await type("example.com");
  expect(titles()[0]).toBe("Open https://example.com");
  await press("Enter");
  expect(state.openLink).toHaveBeenLastCalledWith("https://example.com/", { source: "launcher", modifiers: { meta: false, shift: false } });
  await type("bb://page/pg_9");
  expect(titles()[0]).toBe("Open bb://page/pg_9");
  await press("Enter");
  expect(state.openLink).toHaveBeenLastCalledWith("bb://page/pg_9", { source: "launcher", modifiers: { meta: false, shift: false } });
  await type("todos");
  expect(rows().find((row) => row.textContent?.startsWith("Todos"))?.textContent).toContain("Off");
  await act(async () => { rows().find((row) => row.textContent?.startsWith("Todos"))!.click(); });
  expect(state.set).toHaveBeenCalledWith({ loopsEnabled: true });
});

it("stays open and says why when a row fails", async () => {
  state.rpc.mockImplementation(async (method: string) => {
    if (method === "bot_ask") throw new Error("Dot is paused.");
    return method === "newtab_recents" || method === "newtab_search" ? { entries: [] } : method === "bot_spaces" ? { bots: [{ id: "bot_1", name: "Dot", mainThreadId: "thr_main" }], currentBotId: "bot_1" } : [];
  });
  await mount();
  await type("what should I do next");
  await press("Enter");
  expect($('[data-testid="launcher-error"]')?.textContent).toBe("Dot is paused.");
  expect(state.windows.close).not.toHaveBeenCalled();
});

it("registers nothing on a BB without the launcher slot, and Studio's apps and actions where it has one", () => {
  expect(registerLauncherItems({})).toBe(false);
  const ids: string[] = [];
  expect(registerLauncherItems({ experimental_launcherItem: (item: { id: string }) => { ids.push(item.id); } })).toBe(true);
  expect(ids).toEqual(["studio", "vscode", "new-conversation", "ask-bot", "new-page"]);
});

it("switching to a Bot skips its deleted last conversation and opens its Main", async () => {
  const { rememberConversation, resetSidebarState } = await import("../../ui/conversations/state");
  rememberConversation("bot_1", "thr_gone");
  await mount();
  await press("7", { metaKey: true });
  await act(async () => {});
  expect(calls("bot_landing")).toEqual([{ botId: "bot_1", last: "thr_gone" }]);
  expect(calls("window.openInMain").at(-1)).toEqual({ path: "/threads/thr_main" });
  resetSidebarState();
});
