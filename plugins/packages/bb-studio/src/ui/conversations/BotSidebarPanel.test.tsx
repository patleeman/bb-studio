// @vitest-environment jsdom
import { THEME_CSS } from "../../theme/tokens";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  live: {} as Record<string, unknown>,
  sidebarThreads: [] as unknown[],
  call: vi.fn(async (_method: string, _input: unknown): Promise<unknown> => ({ ok: true })),
  navigate: { toThread: vi.fn(), toCompose: vi.fn(), toPluginPanel: vi.fn() },
  windows: false,
  loopsOn: false,
  gone: new Set<string>(),
}));
vi.mock("../../kit/app/windows", () => ({ get hasHostWindows() { return state.windows; } }));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useBbNavigate: () => state.navigate,
  useSdk: () => ({ threads: { get: async ({ threadId }: { threadId: string }) => { if (state.gone.has(threadId)) throw Object.assign(new Error("Not found"), { status: 404 }); return { id: threadId, projectId: "proj_personal" }; } } }),
  experimental_useSidebarThreads: () => ({ threads: state.sidebarThreads, projects: [] }),
  experimental_ThreadActionsContextMenu: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../live", () => ({
  useLive: (method: string, input: { botId?: string }, options: { enabled?: boolean } = {}) => ({ data: options.enabled === false ? null : (state.live[`${method}:${input?.botId ?? ""}`] ?? state.live[method] ?? null), error: null, loading: false, refresh: () => {} }),
  useCall: () => state.call,
}));
vi.mock("../../kit/app/index", () => ({
  Icon: () => null,
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div data-testid="menu">{children}</div>,
  DropdownMenuItem: ({ children, onSelect }: { children: ReactNode; onSelect?: () => void }) => <div role="menuitem" onClick={() => onSelect?.()}>{children}</div>,
  DropdownMenuSeparator: () => null,
}));
vi.mock("./EditSpace", () => ({ EditSpace: ({ bot, onClose, stage }: { bot: { id: string; name: string }; onClose(): void; stage?: { left: number } | null }) => (
  <section data-testid="edit-space" data-bot-id={bot.id} data-stage={stage ? String(stage.left) : ""}>
    <button type="button" data-testid="edit-space-cancel" onClick={onClose}>Cancel</button>
  </section>
) }));
vi.mock("../bot/DefaultModel", () => ({ DefaultModelDialog: ({ botId, onClose }: { botId: string; onClose(): void }) => (
  <section data-testid="default-model-dialog" data-bot-id={botId}><button type="button" data-testid="default-model-close" onClick={onClose}>Cancel</button></section>
) }));
vi.mock("../../kit/ui/context-menu", () => ({
  ContextMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  ContextMenuContent: ({ children }: { children: ReactNode }) => <div data-testid="context-menu">{children}</div>,
  ContextMenuItem: ({ children, onSelect }: { children: ReactNode; onSelect?: () => void }) => <div role="menuitem" data-testid="context-item" onClick={() => onSelect?.()}>{children}</div>,
  ContextMenuSub: ({ children }: { children: ReactNode }) => <div data-testid="context-sub">{children}</div>,
  ContextMenuSubTrigger: ({ children }: { children: ReactNode }) => <div data-testid="context-sub-trigger">{children}</div>,
  ContextMenuSubContent: ({ children }: { children: ReactNode }) => <div data-testid="context-sub-content">{children}</div>,
  ContextMenuCheckboxItem: ({ children, checked, onSelect }: { children: ReactNode; checked?: boolean; onSelect?: () => void }) => <div role="menuitemcheckbox" aria-checked={!!checked} data-testid="context-check" onClick={() => onSelect?.()}>{children}</div>,
}));
vi.mock("../../loops/ui/hooks", () => ({ useLoopsEnabled: () => state.loopsOn, loopsPath: (botId: string) => `/plugins/studio/studio/bot/${botId}/loops` }));
vi.mock("../bot/BotAvatar", () => ({ BotAvatar: ({ emoji }: { emoji: string }) => <span data-testid="avatar">{emoji}</span> }));

import { BotSidebarPanel } from "./BotSidebarPanel";
import { defaultAppearance } from "../../theme/appearance";
import { NORD } from "../../theme/builtin/classic";
import { GRID } from "../../theme/builtin/grid";
import { resetSceneSignals, sceneSignals } from "../../theme/signals";
import { forgetSavedAppearance } from "../../theme/ui/state";
import { canShowBot, hasLanded, rememberConversation, resetSidebarState, showBotNumber } from "./state";

const space = (id: string, name: string, needsYou: boolean, mainThreadId: string, theme: unknown = null) => ({ id, name, avatar: "🤖", shape: null, color: null, avatarImageUrl: null, primary: id === "cos", mainThreadId, needsYou, theme });
const NOW = Date.now();

let root: Root;
let host: HTMLDivElement;
const $ = (selector: string) => host.querySelector<HTMLElement>(selector);
const $$ = (selector: string) => [...host.querySelectorAll<HTMLElement>(selector)];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  resetSidebarState();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state.call.mockClear();
  state.gone.clear();
  for (const fn of Object.values(state.navigate)) fn.mockClear();
  state.sidebarThreads = [{ id: "fork", status: "active", runtimeStatus: "active", updatedAt: NOW, projectId: "p", parentThreadId: null, parentNotifications: "auto", archivedAt: null, pinnedAt: null, sectionId: null, isUnread: false, environment: null }];
  state.live = {
    bot_spaces: { bots: [space("cos", "Chief of Staff", false, "main"), space("home", "Home", true, "home_main")], currentBotId: "cos" },
    "bot_threads_view:cos": {
      botId: "cos", hiddenWorkers: 2, hiddenToday: 0, olderConversations: 0,
      conversations: [
        { threadId: "main", title: "Main", isMain: true, forkedFrom: null, projectId: "proj_personal", updatedAt: NOW - 4 * 60_000, latest: "Finished “Launch prep”", running: false, needsYou: null },
        { threadId: "fork", title: "Fork redesign", isMain: false, forkedFrom: null, projectId: "p", updatedAt: NOW - 6 * 60_000, latest: "UX review is back", running: false, needsYou: null },
        { threadId: "trunc", title: "Tree truncation", isMain: false, forkedFrom: { threadId: "fork", messageId: "m1", title: "Fork redesign" }, projectId: "p", updatedAt: NOW - 60 * 60_000, latest: null, running: false, needsYou: { reason: "cut titles at the end or the middle?", at: NOW } },
      ],
      workers: [
        { threadId: "lead", title: "Fable lead: sidebar rewrite", status: "running", ownerConversationId: "fork", ownerTitle: "Fork redesign", projectId: "p", updatedAt: NOW, tag: "bb-studio-native", branch: "exp/studio-native", mirrored: false, sameTitle: 1 },
        { threadId: "ios", title: "Codex: iOS build", status: "failed", ownerConversationId: "main", ownerTitle: "Main", projectId: "p", updatedAt: NOW - 3 * 60 * 60_000, tag: null, branch: null, mirrored: false, sameTitle: 1 },
      ],
    },
  };
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

async function mount(activeThreadId: string | null = "fork") {
  await act(async () => { root.render(<BotSidebarPanel onNavigate={() => {}} activeThreadId={activeThreadId} />); });
}

it("draws the current Bot: its name, conversations in two lines with the needs-you one outlined, its workers, and a dot per Bot", async () => {
  await mount();
  expect($('[data-testid="bot-sidebar-name"]')?.textContent).toBe("Chief of Staff");
  const rows = $$('[data-testid="conversation-row"]');
  expect(rows.map((row) => row.dataset.threadId)).toEqual(["main", "fork", "trunc"]);
  // BB's live state: the fork is working right now, and it's the one on screen.
  expect(rows[1]!.getAttribute("aria-current")).toBe("page");
  expect(rows[1]!.querySelector('[data-testid="conversation-line"]')?.getAttribute("data-tone")).toBe("running");
  expect(rows[2]!.hasAttribute("data-needs-you")).toBe(true);
  expect(rows[2]!.querySelector('[data-testid="conversation-line"]')?.textContent).toBe("Needs you: cut titles at the end or the middle?");
  expect(rows[2]!.querySelector('[data-testid="forked-from"]')).toBeNull();
  expect(rows[0]!.textContent).toContain("4m");
  const workers = $$('[data-testid="worker-row"]');
  expect(workers.map((row) => [row.dataset.status, row.querySelector('[data-testid="worker-tag"]')?.textContent ?? null])).toEqual([["running", "bb-studio-native"]]);
  expect($('[data-testid="workers-done"]')?.textContent).toBe("1 done");
  // Workers are the active ones and the done row: older ones are on the Archive page.
  expect($('[data-testid="older-workers"]')).toBeNull();
  expect($('[data-testid="older-conversations"]')).toBeNull();
  const dots = $$('[data-testid="space-dot"]');
  expect(dots.map((dot) => [dot.dataset.botId, dot.hasAttribute("data-active"), dot.hasAttribute("data-amber")])).toEqual([["cos", true, false], ["home", false, true]]);
  // The server hears which Bot is shown.
  expect(state.call).toHaveBeenCalledWith("bot_focus", { botId: "cos" });
});

it("switches Bots with a dot or Studio: Show Bot <n>, landing on that Bot's last conversation, else its Main", async () => {
  expect(canShowBot(1)).toBe(false);
  await mount();
  await act(async () => { $$('[data-testid="space-dot"]')[1]!.click(); });
  expect(state.navigate.toThread).toHaveBeenLastCalledWith("home_main");
  expect(state.call).toHaveBeenCalledWith("bot_focus", { botId: "home" });
  expect($('[data-testid="bot-sidebar-name"]')?.textContent).toBe("Home");
  rememberConversation("cos", "fork");
  // The command (Ctrl+Option+1 by default, BB's keybinding) runs while the sidebar is mounted, for the Bots it has.
  expect([canShowBot(1), canShowBot(2), canShowBot(3)]).toEqual([true, true, false]);
  await act(async () => { expect(showBotNumber(1)).toBe(true); });
  expect(state.navigate.toThread).toHaveBeenLastCalledWith("fork");
  expect($('[data-testid="bot-sidebar-name"]')?.textContent).toBe("Chief of Staff");
  expect($$('[data-testid="space-dot"]')[0]!.getAttribute("aria-keyshortcuts")).toBe("Control+Alt+1");
  // Ctrl+2 is BB's own "Open thread 2", not a switch.
  state.navigate.toThread.mockClear();
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "2", ctrlKey: true, bubbles: true })); });
  expect(state.navigate.toThread).not.toHaveBeenCalled();
  act(() => root.unmount());
  expect(canShowBot(1)).toBe(false);
  root = createRoot(host);
});

it("skips a deleted last conversation or Main when it switches Bots, and opens the Bot's page when both are gone", async () => {
  await mount();
  rememberConversation("home", "home_old");
  state.gone.add("home_old");
  await act(async () => { $$('[data-testid="space-dot"]')[1]!.click(); });
  expect(state.navigate.toThread).toHaveBeenLastCalledWith("home_main");
  await act(async () => { $$('[data-testid="space-dot"]')[0]!.click(); });
  state.navigate.toThread.mockClear();
  state.gone.add("home_main");
  await act(async () => { $$('[data-testid="space-dot"]')[1]!.click(); });
  expect(state.navigate.toThread).not.toHaveBeenCalled();
  expect(state.navigate.toPluginPanel).toHaveBeenLastCalledWith("studio", { subPath: "bot/home" });
});

it("stays on the Bot it switched to while another Bot's thread is still on screen, and follows a thread opened after", async () => {
  // Home has no Main yet: the switch leaves Chief of Staff's thread on screen.
  state.live.bot_spaces = { bots: [space("cos", "Chief of Staff", false, "main"), { ...space("home", "Home", false, "home_main"), mainThreadId: null }], currentBotId: "cos" };
  state.live["bot_threads_view:home"] = { botId: "home", hiddenWorkers: 0, hiddenToday: 0, olderConversations: 0, conversations: [], workers: [] };
  state.live.bot_thread_info = { info: { threadId: "fork", botId: "cos", archivedAt: null } };
  await mount("fork");
  await act(async () => { $$('[data-testid="space-dot"]')[1]!.click(); });
  await mount("fork");
  expect($('[data-testid="bot-sidebar-name"]')?.textContent).toBe("Home");
  // A link to another of Chief of Staff's threads shows Chief of Staff again.
  state.live.bot_thread_info = { info: { threadId: "lead", botId: "cos", archivedAt: null } };
  await mount("lead");
  expect($('[data-testid="bot-sidebar-name"]')?.textContent).toBe("Chief of Staff");
});

it("opens a row in the main view, and + New opens BB's composer for this Bot in its Main's project", async () => {
  await mount(null);
  await act(async () => { $$('[data-testid="worker-row"]')[0]!.click(); });
  expect(state.navigate.toThread).toHaveBeenCalledWith("lead");
  await act(async () => { $('[data-testid="new-conversation"]')!.click(); });
  expect(state.call).toHaveBeenCalledWith("bot_focus", { botId: "cos" });
  expect(state.navigate.toPluginPanel).toHaveBeenCalledWith("studio", { subPath: "new-conversation/cos/proj_personal" });
  expect(state.navigate.toCompose).not.toHaveBeenCalled();
  await act(async () => { $('[data-testid="space-page-memory"]')!.click(); });
  expect(state.navigate.toPluginPanel).toHaveBeenCalledWith("studio", { subPath: "memory/cos" });
});

it("keeps the header clickable in the desktop app, and with one Bot shows its icon and + for a new one", async () => {
  state.live.bot_spaces = { bots: [space("cos", "Chief of Staff", false, "main")], currentBotId: "cos" };
  await mount();
  expect($("header")?.getAttribute("data-studio-no-drag")).toBe("all");
  expect($$('[data-testid="space-dot"]')).toHaveLength(1);
  await act(async () => { $('[data-testid="space-new"]')!.click(); });
  expect(state.navigate.toPluginPanel).toHaveBeenLastCalledWith("studio", { subPath: "bot/new" });
});

it("ends Conversations with a quiet row for the older ones, and Archive in the menu opens the same page", async () => {
  (state.live["bot_threads_view:cos"] as { olderConversations: number }).olderConversations = 41;
  await mount();
  expect($('[data-testid="older-conversations"]')?.textContent).toBe("41 older conversations");
  await act(async () => { $('[data-testid="older-conversations"]')!.click(); });
  expect(state.navigate.toPluginPanel).toHaveBeenLastCalledWith("studio", { subPath: "conversations/cos" });
  state.navigate.toPluginPanel.mockClear();
  await act(async () => { $$('[data-testid="menu"] [role="menuitem"]').find((item) => item.textContent === "Archive")!.click(); });
  expect(state.navigate.toPluginPanel).toHaveBeenLastCalledWith("studio", { subPath: "conversations/cos" });
});

it("keeps the space dots pinned to the bottom of a long list: the panel grows with its rows and the footer sticks", async () => {
  const view = state.live["bot_threads_view:cos"] as { conversations: unknown[] };
  view.conversations = [...view.conversations, ...Array.from({ length: 60 }, (_, n) => ({ threadId: `c${n}`, title: `Conversation ${n}`, isMain: false, forkedFrom: null, projectId: "p", updatedAt: NOW - n * 60_000, latest: null, running: false, needsYou: null }))];
  await mount();
  const nav = $('[data-testid="bot-sidebar"]')!;
  // BB's sidebar content is a scrolling flex column: a panel that shrinks to its height lets the footer scroll away with the rows.
  expect(nav.className.split(" ")).toEqual(expect.arrayContaining(["shrink-0", "min-h-full", "flex-col"]));
  const footer = $('[data-testid="space-dots"]')!.closest("footer")!;
  expect(footer.tagName).toBe("FOOTER");
  expect(footer.className.split(" ")).toEqual(expect.arrayContaining(["sticky", "bottom-0"]));
  expect(nav.lastElementChild).toBe(footer);
  expect($$('[data-testid="conversation-row"]')).toHaveLength(63);
});

it("at launch, opens the Bot's last conversation (Main by default) instead of BB's empty new-thread page, once", async () => {
  window.history.replaceState(null, "", "/");
  await mount(null);
  expect(state.navigate.toThread).toHaveBeenCalledTimes(1);
  expect(state.navigate.toThread).toHaveBeenCalledWith("main");
  expect(hasLanded()).toBe(true);
  window.history.replaceState({ usr: { focusPrompt: true }, key: "n", idx: 1 }, "", "/somewhere");
  window.history.replaceState({ usr: { focusPrompt: true }, key: "n", idx: 1 }, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await mount(null);
  expect(state.navigate.toThread).toHaveBeenCalledTimes(1);
  // The last-open conversation wins while it is still listed; a thread on screen is left alone.
  resetSidebarState();
  rememberConversation("cos", "trunc");
  await act(async () => root.unmount());
  root = createRoot(host);
  await mount(null);
  expect(state.navigate.toThread).toHaveBeenLastCalledWith("trunc");
  resetSidebarState();
  state.navigate.toThread.mockClear();
  await act(async () => root.unmount());
  root = createRoot(host);
  await mount("fork");
  expect(state.navigate.toThread).not.toHaveBeenCalled();
});

it("after an archive or Home leaves BB's new-thread page on screen, opens the Bot's Main, not its last conversation", async () => {
  window.history.replaceState(null, "", "/threads/fork");
  await mount("fork");
  expect(state.navigate.toThread).not.toHaveBeenCalled();
  rememberConversation("cos", "trunc");
  window.history.pushState(null, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await mount(null);
  expect(state.navigate.toThread).toHaveBeenCalledTimes(1);
  expect(state.navigate.toThread).toHaveBeenCalledWith("main");
});

it("keeps BB's own New thread page: an arrival that asked for a new thread stays, even once BB clears that state", async () => {
  window.history.replaceState(null, "", "/threads/fork");
  await mount("fork");
  window.history.pushState({ usr: { focusPrompt: true }, key: "a", idx: 2 }, "", "/");
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.history.replaceState(null, "", "/");
  await mount(null);
  expect(state.navigate.toThread).not.toHaveBeenCalled();
});

it("leaves any other page alone at launch (a link, a reload on a page)", async () => {
  window.history.replaceState(null, "", "/somewhere");
  await mount(null);
  expect(state.navigate.toThread).not.toHaveBeenCalled();
  expect(hasLanded()).toBe(true);
});

it("draws titles at 13px/500 with the second line and time at 55% ink; a row with nothing to say has one line", async () => {
  await mount();
  const main = $$('[data-testid="conversation-row"]')[0]!;
  expect(main.querySelector('[data-testid="conversation-title"]')?.className.split(" ")).toEqual(expect.arrayContaining(["text-[13px]", "font-medium"]));
  expect(main.querySelector('[data-testid="conversation-time"]')?.className).toContain("var(--foreground)_55%");
  expect(main.querySelector('[data-testid="conversation-line"]')?.className).toContain("var(--foreground)_55%");
  const view = state.live["bot_threads_view:cos"] as { conversations: { latest: string | null }[] };
  state.live["bot_threads_view:cos"] = { ...view, conversations: [{ ...view.conversations[0]!, latest: null }, ...view.conversations.slice(1)] };
  await mount();
  expect($$('[data-testid="conversation-row"]')[0]!.querySelector('[data-testid="conversation-line"]')).toBeNull();
});

it("keeps the Bot header at the top while the list scrolls, and its menu lists the Bot's actions", async () => {
  await mount();
  expect($('[data-testid="bot-sidebar-header"]')?.className.split(" ")).toEqual(expect.arrayContaining(["sticky", "top-0"]));
  expect($$('[data-testid="menu"] [role="menuitem"]').map((item) => item.textContent)).toEqual(["Edit space…", "Default model", "Archive", "New Bot"]);
});

it("draws + New as BB's ghost button, named New conversation", async () => {
  await mount();
  const button = $('[data-testid="new-conversation"]') as HTMLButtonElement;
  expect(button.textContent).toBe("+ New");
  expect(button.getAttribute("aria-label")).toBe("New conversation");
  expect(button.className.split(" ")).toEqual(expect.arrayContaining(["cursor-pointer", "hover:bg-state-hover", "active:bg-state-active", "focus-visible:ring-1"]));
});

it("rows carry no native tooltip of their own", async () => {
  await mount();
  for (const selector of ['[data-testid="conversation-row"]', '[data-testid="worker-row"]', '[data-testid="worker-tag"]', '[data-status="running"]', '[data-status="needs-you"]']) {
    for (const element of $$(selector)) expect(element.hasAttribute("title")).toBe(false);
  }
});

it("has the same Bot menu where BB has plugin windows", async () => {
  state.windows = true;
  try {
    await mount();
    const items = $$('[data-testid="menu"] [role="menuitem"]');
    expect(items.map((item) => item.textContent)).toEqual(["Edit space…", "Default model", "Archive", "New Bot"]);
  } finally { state.windows = false; }
});

it("draws a worker row with a narrow tag, a short time, and ×N for a folded title", async () => {
  const view = state.live["bot_threads_view:cos"] as { workers: { sameTitle: number }[] };
  view.workers[1]!.sameTitle = 5;
  await mount();
  await act(async () => { $('[data-testid="workers-done"]')!.click(); });
  const [lead, ios] = $$('[data-testid="worker-row"]');
  expect(lead!.querySelector('[data-testid="worker-tag"]')?.className).toContain("max-w-[72px]");
  expect(lead!.querySelector('[data-testid="worker-tag"]')?.className).toContain("shrink-0");
  expect(lead!.querySelector('[data-testid="worker-time"]')?.textContent).toBe("now");
  expect(ios!.querySelector('[data-testid="worker-time"]')?.textContent).toBe("3h");
  expect(ios!.querySelector('[data-testid="worker-repeats"]')?.textContent).toBe("×5");
  expect(lead!.querySelector('[data-testid="worker-repeats"]')).toBeNull();
});

it("shows only the active workers, folds the done ones into one row that opens and closes in place", async () => {
  const view = state.live["bot_threads_view:cos"] as { workers: { threadId: string; status: string }[] };
  view.workers.push({ ...view.workers[0]!, threadId: "ask", status: "needs-you" }, { ...view.workers[1]!, threadId: "old", status: "done" });
  await mount(null);
  const ids = () => $$('[data-testid="worker-row"]').map((row) => row.dataset.threadId);
  expect(ids()).toEqual(["ask", "lead"]);
  const done = $('[data-testid="workers-done"]')!;
  expect(done.textContent).toBe("2 done");
  expect(done.getAttribute("aria-expanded")).toBe("false");
  await act(async () => { done.click(); });
  expect(ids()).toEqual(["ask", "lead", "ios", "old"]);
  expect(done.getAttribute("aria-expanded")).toBe("true");
  await act(async () => { done.click(); });
  expect(ids()).toEqual(["ask", "lead"]);
});

it("opens the done workers when the one on screen is among them", async () => {
  await mount("ios");
  expect($$('[data-testid="worker-row"]').map((row) => row.dataset.threadId)).toEqual(["lead", "ios"]);
});

it("says No workers with none, and no done row", async () => {
  (state.live["bot_threads_view:cos"] as { workers: unknown[] }).workers = [];
  await mount();
  expect($('[data-testid="workers-done"]')).toBeNull();
  expect($('[data-testid="workers"]')?.textContent).toContain("No workers");
});

it("lists no older-workers row however many there are; the older conversations row is selected while that page is open", async () => {
  const view = state.live["bot_threads_view:cos"] as { hiddenWorkers: number; hiddenToday: number; olderConversations: number };
  view.hiddenWorkers = 343;
  view.hiddenToday = 3;
  view.olderConversations = 4;
  await mount();
  expect($('[data-testid="older-workers"]')).toBeNull();
  expect($('[data-testid="workers"]')!.textContent).not.toContain("older");
  expect($('[data-testid="older-conversations"]')?.getAttribute("aria-current")).toBeNull();
  window.history.replaceState(null, "", "/plugins/studio/studio/conversations/cos");
  await mount();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 450)); });
  expect($('[data-testid="older-conversations"]')?.getAttribute("aria-current")).toBe("page");
  window.history.replaceState(null, "", "/");
});

describe("the Bot's space (round 7)", () => {
  afterEach(() => { window.history.replaceState(null, "", "/"); state.loopsOn = false; });

  it("heads the sidebar with the Bot's status only, never a model: running, Paused, Paused · in bb, or nothing", async () => {
    state.live.bot_list = { bots: [{ id: "cos", state: "active", model: "claude-opus-5-5", modelName: "Opus 5.5", defaultModel: { providerId: "claude", model: "claude-opus-5-5", reasoningLevel: "high", modelName: "Opus 5.5" } }] };
    await mount();
    expect($('[data-testid="bot-sidebar-line"]')!.textContent).toBe("2 running");
    expect($('[data-testid="bot-sidebar-header"]')!.textContent).not.toContain("Opus");
    state.live.bot_list = { bots: [{ id: "cos", state: "paused", modelName: "Opus 5.5" }] };
    await mount();
    expect($('[data-testid="bot-sidebar-line"]')!.textContent).toBe("Paused");
    // A Bot a BB Studio copy imported and doesn't run.
    state.live.bot_list = { bots: [{ id: "cos", state: "stopped", inBb: true }] };
    await mount();
    expect($('[data-testid="bot-sidebar-line"]')!.textContent).toBe("Paused · in bb");
    // Active with nothing running: no line.
    state.sidebarThreads = [];
    state.live["bot_threads_view:cos"] = { ...(state.live["bot_threads_view:cos"] as object), conversations: [], workers: [] };
    state.live.bot_list = { bots: [{ id: "cos", state: "active" }] };
    await mount();
    expect($('[data-testid="bot-sidebar-line"]')).toBeNull();
  });

  it("opens the Default model picker for the shown Bot from its menu", async () => {
    await mount();
    expect($('[data-testid="default-model-dialog"]')).toBeNull();
    await act(async () => { $$('[data-testid="menu"] [role="menuitem"]').find((item) => item.textContent === "Default model")!.click(); });
    expect($('[data-testid="default-model-dialog"]')?.dataset.botId).toBe("cos");
    await act(async () => { $('[data-testid="default-model-close"]')!.click(); });
    expect($('[data-testid="default-model-dialog"]')).toBeNull();
  });

  it("lists the Bot's pages as rows, opens each, and selects the one on screen", async () => {
    await mount();
    expect($$('nav[aria-label="Bot pages"] button').map((row) => row.children[1]?.textContent)).toEqual(["Memory", "Skills", "Library", "Todos"]);
    await act(async () => { $('[data-testid="space-page-skills"]')!.click(); });
    expect(state.navigate.toPluginPanel).toHaveBeenLastCalledWith("studio", { subPath: "skills/cos" });
    await act(async () => { $('[data-testid="space-page-library"]')!.click(); });
    expect(state.navigate.toPluginPanel).toHaveBeenLastCalledWith("studio", {});
    await act(async () => { $('[data-testid="space-page-automations"]')!.click(); });
    expect(state.navigate.toPluginPanel).toHaveBeenLastCalledWith("automations");
    window.history.replaceState(null, "", "/plugins/studio/studio/memory/cos");
    await mount();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 450)); });
    expect($('[data-testid="space-page-memory"]')?.getAttribute("aria-current")).toBe("page");
    expect($('[data-testid="space-page-library"]')?.getAttribute("aria-current")).toBeNull();
  });

  it("names another Bot's page row Scheduled: the Todos list is the primary Bot's", async () => {
    state.loopsOn = true;
    state.live.bot_spaces = { bots: [space("cos", "Chief of Staff", false, "main"), space("home", "Home", false, "home_main")], currentBotId: "home" };
    await mount();
    expect($$('nav[aria-label="Bot pages"] button').map((row) => row.children[1]?.textContent)).toEqual(["Memory", "Skills", "Library", "Scheduled"]);
    expect($('[data-testid="space-page-todos"]')).toBeNull();
    await act(async () => { $('[data-testid="space-page-automations"]')!.click(); });
    expect(state.navigate.toPluginPanel).toHaveBeenLastCalledWith("automations");
  });

  it("adds Todos with what needs the user now, for the primary Bot with Todos on", async () => {
    state.loopsOn = true;
    state.live["loops.list"] = { needsYouNow: [{}, {}, {}], comingUp: [], agentsOnIt: [], waitingOnOthers: [], done: [] };
    await mount();
    expect($('[data-testid="space-todos-count"]')?.textContent).toBe("3");
    expect($$('nav[aria-label="Bot pages"] button').map((row) => row.children[1]?.textContent)).toEqual(["Memory", "Skills", "Library", "Todos"]);
    expect($('[data-testid="space-page-automations"]')).toBeNull();
    await act(async () => { $('[data-testid="space-page-todos"]')!.click(); });
    expect(state.navigate.toPluginPanel).toHaveBeenLastCalledWith("studio", { subPath: "bot/cos/loops" });
  });

  it("opens Edit space in the sidebar from the menu or a right-click on a Bot, in place of the lists", async () => {
    await mount();
    await act(async () => { $$('[data-testid="menu"] [role="menuitem"]').find((item) => item.textContent === "Edit space…")!.click(); });
    expect($('[data-testid="edit-space"]')?.dataset.botId).toBe("cos");
    expect($('[data-testid="conversations"]')).toBeNull();
    await act(async () => { $('[data-testid="edit-space-cancel"]')!.click(); });
    expect($('[data-testid="edit-space"]')).toBeNull();
    await act(async () => { $$('[data-testid="context-item"]')[1]!.click(); });
    expect($('[data-testid="edit-space"]')?.dataset.botId).toBe("home");
    expect(state.navigate.toThread).toHaveBeenLastCalledWith("home_main");
  });

  it("leaves out the Bot switcher while Edit space is in the sidebar, so nothing covers its Cancel and Save", async () => {
    await mount();
    expect($('[data-testid="space-dots"]')).not.toBeNull();
    await act(async () => { $$('[data-testid="menu"] [role="menuitem"]').find((item) => item.textContent === "Edit space…")!.click(); });
    expect($('[data-testid="edit-space"]')!.dataset.stage).toBe("");
    expect($('[data-testid="space-dots"]')).toBeNull();
    expect($('[data-testid="bot-sidebar"]')!.querySelector("footer")).toBeNull();
    await act(async () => { $('[data-testid="edit-space-cancel"]')!.click(); });
    expect($('[data-testid="space-dots"]')).not.toBeNull();
  });

  it("opens Edit space over BB's main view where there is one, keeping the lists and the switcher in the sidebar", async () => {
    const main = document.createElement("main");
    main.dataset.sidebar = "inset";
    main.getBoundingClientRect = () => ({ top: 40, left: 300, width: 900, height: 700 }) as DOMRect;
    document.body.append(main);
    try {
      await mount();
      await act(async () => { $$('[data-testid="menu"] [role="menuitem"]').find((item) => item.textContent === "Edit space…")!.click(); });
      expect($('[data-testid="edit-space"]')!.dataset.stage).toBe("300");
      expect($('[data-testid="conversations"]')).not.toBeNull();
      expect($('[data-testid="space-dots"]')).not.toBeNull();
    } finally {
      main.remove();
    }
  });

  it("gives a Bot with no theme bb's plain sidebar, even when its row still carries the old tint: no background, grain or accent of its own", async () => {
    state.live.bot_spaces = { bots: [space("cos", "Chief of Staff", false, "main", { colors: ["#4f7df2"], mode: "dark", grain: 0.5 }), space("home", "Home", true, "home_main")], currentBotId: "cos" };
    await mount();
    const nav = $('[data-testid="bot-sidebar"]')!;
    expect(nav.style.background).toBe("");
    expect(nav.hasAttribute("data-space-tint")).toBe(false);
    expect($('[data-testid="space-grain"]')).toBeNull();
    expect(nav.querySelectorAll("style").length ? [...nav.querySelectorAll("style")].map((each) => each.textContent).join("") : "").not.toContain("accent");
    expect($('[data-testid="bot-sidebar-header"]')!.style.background).toBe("var(--sidebar, var(--background))");
    expect($('[data-testid="bot-sidebar"] footer')!.style.background).toBe("var(--sidebar, var(--background))");
    expect($$('[data-testid="space-dot-accent"]')).toEqual([]);
  });

  it("marks a Bot that needs the user amber", async () => {
    await mount();
    expect($$('[data-testid="space-dot"]').map((dot) => !!dot.querySelector('[data-testid="space-dot-amber"]'))).toEqual([false, true]);
  });
});

describe("themes (round 8)", () => {
  const grid = defaultAppearance(GRID);
  const nord = defaultAppearance(NORD);
  beforeEach(() => {
    state.live.bot_spaces = { bots: [{ ...space("cos", "Chief of Staff", false, "main"), appearance: grid }, { ...space("home", "Home", true, "home_main"), appearance: nord }, { ...space("plain", "Plain", false, "plain_main"), appearance: null }], currentBotId: "cos" };
  });
  afterEach(() => resetSceneSignals());

  it("marks each Bot's icon in the switcher with its theme's accent, and none without a theme", async () => {
    await mount();
    const accents = $$('[data-testid="space-dot"]').map((dot) => [dot.dataset.botId, dot.querySelector<HTMLElement>('[data-testid="space-dot-accent"]')?.style.background ?? null]);
    expect(accents).toEqual([["cos", "rgb(95, 246, 255)"], ["home", "rgb(136, 192, 208)"], ["plain", null]]);
  });

  it("gives a running worker the dot of its character in the scene, and hands the scene the Bot's workers and conversations", async () => {
    await mount();
    const running = $('[data-testid="worker-row"][data-status="running"]')!;
    expect(running.querySelector('[data-testid="worker-dot"]')?.getAttribute("data-worker-slot")).toBe("0");
    expect(sceneSignals()).toMatchObject({ botId: "cos", workers: [{ threadId: "lead", status: "running" }, { threadId: "ios", status: "failed" }] });
    expect(sceneSignals().conversations.find((row) => row.threadId === "trunc")).toEqual({ threadId: "trunc", running: false, needsYou: true });
  });

  it("is one piece under a scene theme, for the host's single sidebar card: no cards of its own, and the switcher pinned last on the sidebar's glass, with no border", async () => {
    await mount();
    expect($$("[data-fork-card]")).toHaveLength(0);
    const sidebar = $('[data-testid="bot-sidebar"]')!;
    expect(sidebar.textContent).toContain("Memory");
    for (const id of ["conversations", "workers", "space-dots"]) expect(sidebar.querySelector(`[data-testid="${id}"]`)?.closest('[data-testid="bot-sidebar"]')).toBe(sidebar);
    const footer = $("footer")!;
    expect(sidebar.lastElementChild).toBe(footer);
    expect(footer.querySelector('[data-testid="space-dots"]')).not.toBeNull();
    expect(footer.style.background).toBe("");
    expect(footer.style.backdropFilter).toBe("");
    expect(footer.className).not.toMatch(/border|sticky|bg-/);
    const rows = $('[data-testid="bot-sidebar-rows"]')!;
    expect(rows.nextElementSibling === footer || rows.parentElement === sidebar).toBe(true);
    expect(rows.contains(footer)).toBe(false);
    expect(rows.className.split(" ")).toEqual(expect.arrayContaining(["min-h-0", "flex-1", "overflow-y-auto"]));
    expect(rows.hasAttribute("data-fork-overlay-scroll")).toBe(true);
    expect(THEME_CSS).toContain('html[data-studio-glass] [data-sidebar="content"][data-studio-own-scroll] { overflow: hidden; scrollbar-gutter: auto; }');
    expect(sidebar.className.split(" ")).toEqual(expect.arrayContaining(["h-full", "min-h-0", "flex-col"]));
    for (const id of ["conversations", "workers", "bot-sidebar-header"]) expect(rows.querySelector(`[data-testid="${id}"]`)).not.toBeNull();
    const header = $('[data-testid="bot-sidebar-header"]')!;
    expect(header.style.background).toBe("");
    expect(header.className).not.toMatch(/border|sticky/);
  });

  it("keeps the switcher's bar under a classic theme", async () => {
    state.live.bot_spaces = { bots: [{ ...space("home", "Home", true, "home_main"), appearance: nord }], currentBotId: "home" };
    await mount();
    expect($$("[data-fork-card]")).toHaveLength(0);
    expect($("footer")!.className).toContain("border-t");
  });

  it("keeps the spinner when the Bot's workers aren't in the scene", async () => {
    state.live.bot_spaces = { bots: [{ ...space("cos", "Chief of Staff", false, "main"), appearance: { ...grid, effects: { ...grid.effects, workers: false } } }], currentBotId: "cos" };
    await mount();
    expect($('[data-testid="worker-dot"]')).toBeNull();
    expect($('[data-testid="worker-row"] [data-status="running"]')).not.toBeNull();
  });

  it("has a Theme submenu on each Bot's icon: every theme in the picker's order with that Bot's checked, and a pick applies to that Bot at once", async () => {
    const tuned = { ...grid, glass: 0.9, effects: { ...grid.effects, workers: false } };
    state.live.bot_spaces = { bots: [{ ...space("cos", "Chief of Staff", false, "main"), appearance: tuned }, { ...space("home", "Home", true, "home_main"), appearance: null }], currentBotId: "cos" };
    await mount();
    const subs = $$('[data-testid="context-sub"]');
    expect(subs).toHaveLength(2);
    expect(subs.map((sub) => sub.querySelector('[data-testid="context-sub-trigger"]')!.textContent)).toEqual(["Theme›", "Theme›"]);
    const items = (sub: HTMLElement) => [...sub.querySelectorAll<HTMLElement>('[data-testid="context-check"]')];
    const names = items(subs[0]!).map((item) => item.textContent);
    expect(names.at(-1)).toBe("None");
    expect(names.indexOf("Grid")).toBeLessThan(names.indexOf("Nord"));
    expect(names).toEqual(items(subs[1]!).map((item) => item.textContent));
    const checked = (sub: HTMLElement) => items(sub).filter((item) => item.getAttribute("aria-checked") === "true").map((item) => item.textContent);
    expect(checked(subs[0]!)).toEqual(["Grid"]);
    expect(checked(subs[1]!)).toEqual(["None"]);
    await act(async () => { items(subs[1]!).find((item) => item.textContent === "Nord")!.click(); });
    expect(state.call).toHaveBeenLastCalledWith("bot_set_appearance", { botId: "home", appearance: nord });
    expect(checked($$('[data-testid="context-sub"]')[1]!)).toEqual(["Nord"]);
    expect($('[data-testid="edit-space"]')).toBeNull();
    state.call.mockClear();
    await act(async () => { items($$('[data-testid="context-sub"]')[0]!).find((item) => item.textContent === "Grid")!.click(); });
    expect(state.call).not.toHaveBeenCalled();
    await act(async () => { items($$('[data-testid="context-sub"]')[0]!).find((item) => item.textContent === "Nord")!.click(); });
    expect(state.call).toHaveBeenLastCalledWith("bot_set_appearance", { botId: "cos", appearance: { ...nord, effects: tuned.effects } });
    await act(async () => { items($$('[data-testid="context-sub"]')[0]!).find((item) => item.textContent === "None")!.click(); });
    expect(state.call).toHaveBeenLastCalledWith("bot_set_appearance", { botId: "cos", appearance: null });
    forgetSavedAppearance(["cos", "home"]);
  });
});

it("shows No Bot yet only once first-run setup is over, not while it makes the starter Bot", async () => {
  state.live.bot_spaces = { bots: [], currentBotId: null };
  state.live.bot_welcome = { threadId: null, opened: true, pending: true, bot: null };
  await mount(null);
  expect(host.textContent).not.toContain("No Bot yet");
  state.live.bot_welcome = { threadId: null, opened: true, pending: false, bot: null };
  await mount(null);
  expect(host.textContent).toContain("No Bot yet");
});
