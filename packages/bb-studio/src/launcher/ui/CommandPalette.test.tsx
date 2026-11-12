// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rpc: vi.fn(async (_method: string, _input: unknown): Promise<unknown> => null),
  client: null as unknown,
  navigate: { toThread: vi.fn(), openUrl: vi.fn((_url: string) => true) },
  openLink: vi.fn(async (_link: unknown, _options: unknown) => ({ via: "workbench", pane: null, opened: true })),
  open: vi.fn(),
  windows: { native: true, register: vi.fn(async () => true), open: vi.fn(async () => true), toggle: vi.fn(async () => true), close: vi.fn(async () => true) },
  settings: { launcherHotkey: "Alt+Space" } as Record<string, unknown>,
  items: [] as { key: string; pluginId: string; id: string; title: string; icon: string; section: "apps" | "actions"; keywords?: string[]; order?: number; run: () => void | Promise<void> }[],
  commands: [] as { id: string; title: string; group: string; shortcut?: string; run: () => void }[],
}));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useRpc: () => (state.client ??= { call: (method: string, input: unknown) => state.rpc(method, input) }),
  useRealtime: () => {},
  useBbNavigate: () => state.navigate,
  experimental_Icon: () => null,
  experimental_useLauncherItems: () => state.items,
  experimental_useAppCommands: () => state.commands,
}));
vi.mock("../../presence/ui/BotFace", () => ({ BotFace: ({ botId }: { botId: string }) => <i data-testid="ask-face" data-face={botId} /> }));
vi.mock("../../kit/app/windows", async (original) => ({ ...(await original<typeof import("../../kit/app/windows")>()), hasHostWindows: true, useHostWindows: () => state.windows }));
vi.mock("../../settings/ui/use-settings", () => ({ useStudioSettings: () => ({ values: state.settings, set: vi.fn() }) }));
vi.mock("../../kit/ui/index", () => ({ Icon: () => null, cn: (...parts: unknown[]) => parts.filter(Boolean).join(" ") }));
vi.mock("../../ui/studio-open", () => ({ useStudioOpen: () => state.open }));
vi.mock("../../links/open", () => ({ LinksBridge: () => null, useOpenLink: () => state.openLink }));
vi.mock("../../ui/live", () => ({ useCall: () => vi.fn() }));
vi.mock("../../ui/thread-header", () => ({ useThreadLookup: () => new Map() }));
vi.mock("./Omnibar", async (original) => {
  const module = await original<typeof import("./Omnibar")>();
  return { ...module, Omnibar: vi.fn(module.Omnibar) };
});

import { registerCommandPalette } from "../../kit/app/host-sdk";
import { registerLauncherItems, STUDIO_LAUNCHER_ITEMS } from "../items";
import { StudioCommandPalette } from "./CommandPalette";
import { LauncherWindow } from "./Launcher";
import { Omnibar } from "./Omnibar";
import { defaultAppearance } from "../../theme/appearance";
import { createThemeRegistry } from "../../theme/registry";
import { forgetSavedAppearance } from "../../theme/ui/state";
import { setThemeQuickRuntime, themeChoices } from "../../theme/ui/quick";

let root: Root;
let host: HTMLDivElement;
const close = vi.fn((then?: () => void) => { then?.(); });
const $ = (selector: string) => host.querySelector<HTMLElement>(selector);
const rows = () => [...host.querySelectorAll<HTMLElement>('[data-testid="launcher-row"]')];
const titles = () => rows().map((row) => row.querySelector('[data-testid="launcher-title"]')?.textContent);
const sections = () => [...host.querySelectorAll('[data-testid="launcher-section"]')].map((label) => label.textContent);
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
async function mount(mode: "commands" | "search", path = "/threads/thr_cur", onEscape?: (handler: () => boolean) => () => void) {
  window.history.replaceState({}, "", path);
  await act(async () => { root.render(<StudioCommandPalette initialMode={mode} close={close} experimental_onEscape={onEscape} />); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  close.mockClear();
  state.open.mockClear();
  state.navigate.toThread.mockClear();
  state.navigate.openUrl.mockClear();
  state.openLink.mockClear();
  vi.mocked(Omnibar).mockClear();
  state.items = [];
  registerLauncherItems({ experimental_launcherItem: (item: (typeof STUDIO_LAUNCHER_ITEMS)[number]) => { state.items.push({ ...item, keywords: [...(item.keywords ?? [])], key: `studio/${item.id}`, pluginId: "studio" }); } });
  state.commands = [{ id: "plugin-page:roadmaps/board", title: "Roadmap board", group: "Plugin pages", run: vi.fn() }, { id: "app:window.new", title: "New window", group: "Window and layout", shortcut: "⇧⌘N", run: vi.fn() }];
  state.rpc.mockReset().mockImplementation(async (method: string) => {
    if (method === "newtab_recents") return { entries: [{ id: "page:pg_1", title: "Roadmap", kind: "Page", icon: "FileText", updatedAt: 25, ref: { kind: "page", id: "pg_1" } }, { id: "conversation:thr_2", title: "Plan the offsite", kind: "Conversation", icon: "MessageSquare", updatedAt: 20, ref: { kind: "conversation", id: "thr_2" } }] };
    if (method === "newtab_search") return { entries: [] };
    if (method === "searchAll") return [];
    if (method === "bot_thread_info") return { info: { threadId: "thr_cur", botId: "bot_1", botName: "Chief of Staff", kind: "conversation" } };
    if (method === "bot_spaces") return { bots: [{ id: "bot_1", name: "Chief of Staff", mainThreadId: "thr_main" }, { id: "bot_2", name: "Home", mainThreadId: "thr_home" }], currentBotId: "bot_1" };
    if (method === "bot_ask") return { threadId: (state.rpc.mock.lastCall?.[1] as { to: { kind: string; threadId?: string } }).to.kind === "new" ? "thr_new" : (state.rpc.mock.lastCall?.[1] as { to: { threadId: string } }).to.threadId, projectId: null };
    return { ok: true };
  });
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

it("Cmd+K and the launcher are the same omnibar, and Studio registers it as BB's palette", async () => {
  await mount("commands");
  window.history.replaceState({}, "", "/fork-window/studio/launcher");
  const other = document.createElement("div");
  document.body.append(other);
  const second = createRoot(other);
  await act(async () => { second.render(<LauncherWindow />); });
  expect(vi.mocked(Omnibar).mock.calls.map(([props]) => props.host)).toEqual(expect.arrayContaining(["palette", "launcher"]));
  expect(host.querySelector("[data-studio-launcher]")?.getAttribute("data-omnibar-host")).toBe("palette");
  expect(other.querySelector("[data-studio-launcher]")?.getAttribute("data-omnibar-host")).toBe("launcher");
  act(() => second.unmount());
  other.remove();
  const registered: { id: string; component: unknown }[] = [];
  expect(registerCommandPalette({ experimental_commandPalette: (registration: { id: string; component: unknown }) => { registered.push(registration); } }, { id: "omnibar", component: StudioCommandPalette })).toBe(true);
  expect(registered).toEqual([{ id: "omnibar", component: StudioCommandPalette }]);
  expect(registerCommandPalette({}, { id: "omnibar", component: StudioCommandPalette })).toBe(false);
});

it("search mode (⌘K, the rail's Search) starts on the recent conversations and files", async () => {
  await mount("search");
  expect(titles()).toEqual(["Roadmap", "Plan the offsite"]);
  expect(sections()).toEqual(["Recent"]);
  expect(input().placeholder).toBe("Search, or ask Chief of Staff…");
  expect(calls("newtab_recents")).toEqual([{ threadId: "thr_cur" }]);
});

it("commands mode lists everything: no BB Studio app in BB itself, a switch to the other Bot, BB's commands", async () => {
  await mount("commands");
  expect(sections()).toEqual(["Apps", "Actions", "Recent", "Commands", "Settings"]);
  expect(titles()).not.toContain("BB Studio");
  expect(titles()).toEqual(expect.arrayContaining(["VS Code", "New conversation", "Switch to Home", "Roadmap board", "New window"]));
  expect(titles()).not.toContain("Switch to Chief of Staff");
  expect(titles().some((title) => /hud|pop out/i.test(title ?? ""))).toBe(false);
  await type("new window");
  await press("Enter");
  expect(state.commands[1]!.run).toHaveBeenCalledTimes(1);
  expect(close).not.toHaveBeenCalled();
  await type("vs code");
  close.mockImplementationOnce((then?: () => void) => { act(() => root.unmount()); root = createRoot(host); then?.(); });
  await press("Enter");
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(calls("window.openInMain")).toEqual([{ path: "/plugins/studio/vscode?studioRun=vscode" }]);
});

it("one query gives an entity, a command and Ask Chief of Staff, best match first", async () => {
  await mount("commands");
  await type("roadmap");
  expect(titles()).toEqual(["Roadmap", "Roadmap board", "Ask Chief of Staff: “roadmap”"]);
  expect(sections()).toEqual(["Conversations and files", "Commands"]);
  expect([...document.querySelectorAll<HTMLElement>('[data-testid="ask-face"]')].map((face) => [face.dataset.face, face.closest<HTMLElement>('[data-testid="launcher-row"]')?.dataset.rowType])).toEqual([["bot_1", "ask"]]);
  await press("Enter");
  expect(state.openLink).toHaveBeenCalledWith("bb://page/pg_1", { source: "palette", title: "Roadmap", modifiers: { meta: false, shift: false } });
});

it("Ask: Enter sends to the conversation on screen, Shift+Enter starts a new one and shows it", async () => {
  await mount("search");
  await type("what changed today");
  expect(titles()[0]).toBe("Ask Chief of Staff: “what changed today”");
  await press("Enter");
  expect(calls("bot_ask")).toEqual([{ text: "what changed today", to: { kind: "thread", threadId: "thr_cur" } }]);
  expect(close).toHaveBeenCalledWith(undefined);
  expect(state.navigate.toThread).not.toHaveBeenCalled();
  await press("Enter", { shiftKey: true });
  expect(calls("bot_ask").at(-1)).toEqual({ text: "what changed today", to: { kind: "new", botId: "bot_1" } });
  expect(state.navigate.toThread).toHaveBeenCalledWith("thr_new");
});

it("away from a conversation, Ask goes to the shown Bot's Main; rows go through the link router with the keys held; addresses too", async () => {
  await mount("search", "/plugins/studio/studio");
  await type("what changed today");
  await press("Enter");
  expect(calls("bot_ask")).toEqual([{ text: "what changed today", to: { kind: "thread", threadId: "thr_main" } }]);
  expect(state.navigate.toThread).toHaveBeenLastCalledWith("thr_main");
  await type("offsite");
  await press("Enter", { metaKey: true });
  expect(state.openLink).toHaveBeenLastCalledWith("bb://conversation/thr_2", { source: "palette", title: "Plan the offsite", modifiers: { meta: true, shift: false } });
  await press("Enter", { shiftKey: true });
  expect(state.openLink).toHaveBeenLastCalledWith("bb://conversation/thr_2", { source: "palette", title: "Plan the offsite", modifiers: { meta: false, shift: true } });
  await type("roadmap");
  await press("Enter");
  expect(state.openLink).toHaveBeenLastCalledWith("bb://page/pg_1", { source: "palette", title: "Roadmap", modifiers: { meta: false, shift: false } });
  await type("example.com/docs");
  await press("Enter");
  expect(state.openLink).toHaveBeenLastCalledWith("https://example.com/docs", { source: "palette", modifiers: { meta: false, shift: false } });
  expect(state.navigate.openUrl).not.toHaveBeenCalled();
});

it("leaves Esc to BB's dialog on a BB without experimental_onEscape", async () => {
  await mount("commands");
  await type("road");
  await press("Escape");
  expect(close).not.toHaveBeenCalled();
  expect(input().value).toBe("road");
  expect(host.textContent).toContain("esc to close");
});

it("Esc clears the query first, then BB's dialog closes, as in the launcher", async () => {
  let handler: (() => boolean) | null = null;
  const onEscape = vi.fn((next: () => boolean) => { handler = next; return () => { if (handler === next) handler = null; }; });
  const dialog = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    if (handler?.()) event.preventDefault();
    else close();
  };
  document.addEventListener("keydown", dialog, true);
  try {
    await mount("commands", "/threads/thr_cur", onEscape);
    await type("road");
    expect(host.textContent).toContain("esc to clear");
    await press("Escape");
    expect(input().value).toBe("");
    expect(close).not.toHaveBeenCalled();
    expect(host.textContent).toContain("esc to close");
    await press("Escape");
    expect(close).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    expect(handler).toBeNull();
    root = createRoot(host);
  } finally {
    document.removeEventListener("keydown", dialog, true);
  }
});

it("Cmd+K has Theme: <name> for every theme and Next theme and Previous theme, applied to the Bot on screen", async () => {
  const registry = createThemeRegistry();
  const choices = themeChoices(registry);
  const save = vi.fn(async (_botId: string, _appearance: unknown) => {});
  setThemeQuickRuntime({ bots: [{ id: "bot_1", appearance: defaultAppearance(choices[0]!.theme!) }], shownBotId: "bot_1", registry, save });
  state.commands.push({ id: "plugin:studio/theme-next", title: "Studio: Next theme", group: "Plugins", shortcut: "⌃⌥T", run: vi.fn() }, { id: "plugin:studio/theme-previous", title: "Studio: Previous theme", group: "Plugins", shortcut: "⌃⌥⇧T", run: vi.fn() });
  try {
    await mount("commands");
    expect(titles()).toEqual(expect.arrayContaining(["Next theme", "Previous theme", ...choices.map((choice) => `Theme: ${choice.name}`)]));
    expect(titles()).not.toContain("Studio: Next theme");
    expect(titles()).not.toContain("Studio: Previous theme");
    const themed = titles().filter((title) => title?.startsWith("Theme: "));
    expect(themed).toEqual(choices.map((choice) => `Theme: ${choice.name}`));
    expect(themed.at(-1)).toBe("Theme: None");
    await type("next theme");
    expect(rows()[0]!.textContent).toContain("⌃⌥T");
    await press("Enter");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(save.mock.calls.map(([botId, appearance]) => [botId, (appearance as { themeId: string } | null)?.themeId ?? null])).toEqual([["bot_1", choices[1]!.id]]);
    await type("previous theme");
    await press("Enter");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(save.mock.lastCall![1]).toMatchObject({ themeId: choices[0]!.id });
    await type("theme: none");
    await press("Enter");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(save.mock.lastCall).toEqual(["bot_1", null]);
  } finally {
    setThemeQuickRuntime(null);
    forgetSavedAppearance(["bot_1"]);
  }
});
