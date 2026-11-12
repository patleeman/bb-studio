// @vitest-environment jsdom
// Each kind of opener follows Studio's rule (./studio-open.tsx): in a thread,
// a workbench tab; in the Studio app, a Studio tab; Mod-click the other place.
// Links and reply cards follow the link router (../links/router.ts): the
// workbench, Mod-click the second pane, Shift a window.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  openTab: vi.fn((_options: unknown) => true),
  toThread: vi.fn(),
  openUrl: vi.fn((_url: string) => true),
  composer: { scope: { kind: "thread", threadId: "thr_a" } },
  // Reply cards' reads, by method.
  call: vi.fn(async (method: string, input?: unknown): Promise<unknown> => {
    if (method === "drawings.getDrawingMeta") return { drawing: { id: "drw_0123456789abcdef", name: "Checkout flow", elementCount: 0, updatedAt: 1 } };
    if (method === "recordings.recording_get") return { recording: { id: "rec_weekly01", title: "Weekly sync", durationMs: 60_000, wordCount: 120, status: "done", pendingCount: 0, meetingNotes: null }, segments: [] };
    if (method === "links.resolve") { const { id } = input as { id: string | null }; return id === "pg_gone" ? { found: false, title: null, spec: null } : { found: true, title: id === "thr_z" ? "Zed" : null, spec: null }; }
    return { items: [] };
  }),
  rpc: null as unknown as { call: unknown },
  // The fork's workbench API for the conversation on screen, and its pop-out.
  workbench: {
    threadId: "thr_a",
    open: vi.fn(async (_spec: unknown, _options: unknown): Promise<string | null> => "key-1"),
    layout: () => ({ panel: "open", widthPercent: 40, conversation: "shown", panes: [{ tabs: [], widthPercent: 100 }] }),
    list: () => ({ open: true, selectedKey: null, tabs: [] }),
    close: () => true, focus: () => true, arrange: () => true, isTyping: () => false,
    popOut: vi.fn(async (_key: string) => true),
  },
  popOut: vi.fn(async (_options: { path: string; title?: string }) => true),
}));
sdk.rpc = { call: (...args: [string, unknown?]) => sdk.call(...args) };
vi.mock("@get-bb/plugin-sdk/app", () => ({
  experimental_useAppPanel: () => ({ openTab: sdk.openTab, getTabs: () => ({ open: false, selectedKey: null, tabs: [] }) }),
  useBbNavigate: () => ({ toThread: sdk.toThread, openUrl: sdk.openUrl, toCompose: vi.fn(), toProject: vi.fn(), experimental_workbench: (threadId?: string) => (!threadId || threadId === "thr_a" ? sdk.workbench : null), experimental_popOut: sdk.popOut }),
  useComposer: () => sdk.composer,
  useRpc: () => sdk.rpc,
  useRealtime: () => {},
  useSdk: () => ({ plugins: { callRpc: vi.fn(async () => null) } }),
  experimental_Icon: () => null,
}));
const nav = vi.hoisted(() => ({ openAppPath: vi.fn() }));
vi.mock("../kit/app/nav", async (importOriginal) => ({ ...(await importOriginal<typeof import("../kit/app/nav")>()), openAppPath: nav.openAppPath }));
const workspace = vi.hoisted(() => ({ openWorkspaceItem: vi.fn((_item: unknown, _placement?: unknown) => true) }));
vi.mock("../kit/app/workspace", async (importOriginal) => ({ ...(await importOriginal<typeof import("../kit/app/workspace")>()), openWorkspaceItem: workspace.openWorkspaceItem }));

const { StudioContainerProvider } = await import("./studio-open");
const { usePagesUiValue } = await import("../pages/ui/PagesPanel");
const { OpenInSplitButton } = await import("../kit/app/item-header");
const { ItemGestures } = await import("./ItemGestures");
const { ThreadTabReceiver, resetThreadTabRequests } = await import("../kit/app/thread-panel");
const { PageTabReceiver, resetPageTabRequests } = await import("./page-tab-requests");
const { setTabNavigator } = await import("./tab-open");
const { openTarget } = await import("../minis/ui/mini-frame");
const { DrawingDirective } = await import("../draw/ui/drawing-directive");
const { RecordingCard } = await import("../talk/ui/recording-card");

const PAGE = "/plugins/studio/studio/pages/pg_b";
const ARTIFACT = "/plugins/studio/studio/artifacts/art_3f6f5166257e0457";
const thread = { kind: "thread" as const, threadId: "thr_a" };
const studio = { kind: "studio" as const };
const studioTab = (kind: string, id: string, title?: string) => ({ tab: { id: "studio", context: { kind: "thread" }, availability: "action" }, ...(title ? { title } : {}), params: { kind, id } });
/** What the router hands the workbench API for a Studio item. */
const routedTab = (kind: string, id: string, title: string) => ({ kind: "tab", tab: { id: "studio" }, params: { kind, id }, title });

let root: Root, element: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  for (const mock of [sdk.openTab, sdk.toThread, sdk.openUrl, sdk.call, sdk.workbench.open, sdk.workbench.popOut, sdk.popOut, nav.openAppPath, workspace.openWorkspaceItem]) mock.mockClear();
  window.history.replaceState({}, "", "/threads/thr_a");
  setTabNavigator({ experimental_workbench: (threadId?: string) => (!threadId || threadId === "thr_a" ? sdk.workbench : null) });
  element = document.createElement("div"); document.body.append(element); root = createRoot(element);
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ""; resetThreadTabRequests(); resetPageTabRequests(); setTabNavigator(null); vi.unstubAllGlobals(); });
const settled = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

const render = (node: ReactNode) => act(async () => root.render(node));

describe("page content (mentions, embeds, links in the text)", () => {
  let ui: ReturnType<typeof usePagesUiValue> | null = null;
  const Probe = () => { ui = usePagesUiValue({ call: vi.fn(async () => ({ items: [] })) } as never, [{ id: "pg_b", title: "Release checklist" }] as never, { available: false, reason: null, bots: [] }); return null; };

  it("in a thread's workbench, opens mentions and embeds as workbench tabs, and threads in the main view", async () => {
    await render(<StudioContainerProvider value={thread}><Probe /></StudioContainerProvider>);
    ui!.openPage("pg_b");
    expect(sdk.openTab).toHaveBeenLastCalledWith(studioTab("page", "pg_b", "Release checklist"));
    ui!.openPath(ARTIFACT);
    expect(sdk.openTab).toHaveBeenLastCalledWith(studioTab("artifact", "art_3f6f5166257e0457"));
    ui!.openThread("thr_y");
    expect(sdk.toThread.mock.calls).toEqual([["thr_y", { split: false }]]);
    expect(nav.openAppPath).not.toHaveBeenCalled();
    expect(workspace.openWorkspaceItem).not.toHaveBeenCalled();
  });

  it("a link in the text goes through the link router: the thread's workbench, a thread as a tab too, web links in BB's browser", async () => {
    await render(<StudioContainerProvider value={thread}><Probe /></StudioContainerProvider>);
    ui!.openLink(PAGE);
    await settled();
    expect(sdk.workbench.open).toHaveBeenLastCalledWith(routedTab("page", "pg_b", "Release checklist"), { focus: true });
    ui!.openLink("bb://page/pg_b", { modifiers: { meta: true } });
    await settled();
    expect(sdk.workbench.open).toHaveBeenLastCalledWith(routedTab("page", "pg_b", "Release checklist"), { focus: true, pane: "new" });
    ui!.openLink("/projects/p/threads/thr_z");
    await settled();
    expect(sdk.workbench.open).toHaveBeenLastCalledWith({ kind: "tab", tab: { id: "thread" }, params: { threadId: "thr_z" }, title: "Zed" }, { focus: true });
    ui!.openLink("https://example.com/a");
    await settled();
    expect(sdk.openUrl).toHaveBeenCalledWith("https://example.com/a");
    expect(sdk.openTab).not.toHaveBeenCalled();
    expect(nav.openAppPath).not.toHaveBeenCalled();
  });

  it("Mod-click from a workbench page opens the item in the Studio app", async () => {
    await render(<StudioContainerProvider value={thread}><Probe /></StudioContainerProvider>);
    ui!.openPage("pg_b", { alternate: true });
    expect(workspace.openWorkspaceItem).toHaveBeenCalledWith({ href: PAGE, title: "Release checklist" }, "tab");
    expect(sdk.openTab).not.toHaveBeenCalled();
  });

  it("in the Studio app, opens embeds as Studio tabs, Mod-click in a split, and a link in the text beside the Studio page", async () => {
    window.history.replaceState({}, "", "/plugins/studio/studio");
    await render(<StudioContainerProvider value={studio}><PageTabReceiver /><Probe /></StudioContainerProvider>);
    ui!.openPath(ARTIFACT, { alternate: true });
    expect(workspace.openWorkspaceItem.mock.calls).toEqual([[{ href: ARTIFACT }, "right"]]);
    ui!.openLink(PAGE);
    await settled();
    expect(sdk.openTab).toHaveBeenCalledWith({ tab: { id: "studio", context: { kind: "nav-panel", panelId: "studio" }, availability: "action" }, params: { kind: "page", id: "pg_b" }, title: "Release checklist" });
    expect(sdk.workbench.open).not.toHaveBeenCalled();
  });
});

describe("reply cards", () => {
  const message = { id: "m1", threadId: "thr_a", turnId: null, projectId: null };
  const arrow = (label: string) => element.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  const header = (label: string) => arrow(label).previousElementSibling as HTMLButtonElement;
  const openCard = async (label: string) => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    await act(async () => header(label).click());
  };

  const clickCard = async (label: string, init: MouseEventInit) => {
    await settled();
    await act(async () => header(label).dispatchEvent(new MouseEvent("click", { bubbles: true, ...init })));
    await settled();
  };

  it("a card's arrow button opens the item in the main view, whatever keys are held", async () => {
    await render(<DrawingDirective attributes={{ id: "drw_0123456789abcdef" }} source="" message={message} openWorkspaceFile={null} />);
    await settled();
    await act(async () => arrow("Open Checkout flow").dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true })));
    await settled();
    expect(nav.openAppPath).toHaveBeenCalledWith("/plugins/studio/studio/drawings/drw_0123456789abcdef");
    expect(sdk.workbench.open).not.toHaveBeenCalled();
  });

  it("a whiteboard card opens the whiteboard in its thread's workbench, through the router", async () => {
    await render(<DrawingDirective attributes={{ id: "drw_0123456789abcdef" }} source="" message={message} openWorkspaceFile={null} />);
    await openCard("Open Checkout flow");
    await settled();
    expect(sdk.workbench.open).toHaveBeenCalledWith(routedTab("drawing", "drw_0123456789abcdef", "Checkout flow"), { focus: true });
    expect(sdk.call).toHaveBeenCalledWith("links.resolve", { kind: "whiteboard", id: "drw_0123456789abcdef", threadId: "thr_a" });
    expect(nav.openAppPath).not.toHaveBeenCalled();
  });

  it("a recording card opens in the workbench too, not the Studio app", async () => {
    await render(<RecordingCard attributes={{ id: "rec_weekly01" }} source="" message={message} openWorkspaceFile={null} />);
    await openCard("Open Weekly sync");
    await settled();
    expect(sdk.workbench.open).toHaveBeenCalledWith(routedTab("recording", "rec_weekly01", "Weekly sync"), { focus: true });
    expect(nav.openAppPath).not.toHaveBeenCalled();
  });

  it("Mod-click on a card opens the item in the workbench's second pane; Shift-click in a window of its own", async () => {
    await render(<DrawingDirective attributes={{ id: "drw_0123456789abcdef" }} source="" message={message} openWorkspaceFile={null} />);
    await clickCard("Open Checkout flow", { metaKey: true });
    expect(sdk.workbench.open).toHaveBeenCalledWith(routedTab("drawing", "drw_0123456789abcdef", "Checkout flow"), { focus: true, pane: "new" });
    await clickCard("Open Checkout flow", { shiftKey: true });
    expect(sdk.popOut).toHaveBeenCalledWith({ path: "/plugins/studio/studio/drawings/drw_0123456789abcdef", title: "Checkout flow" });
    expect(workspace.openWorkspaceItem).not.toHaveBeenCalled();
    expect(sdk.openTab).not.toHaveBeenCalled();
  });

  it("when the workbench declines, a card falls back to the item's page", async () => {
    sdk.workbench.open.mockResolvedValueOnce(null);
    await render(<DrawingDirective attributes={{ id: "drw_0123456789abcdef" }} source="" message={message} openWorkspaceFile={null} />);
    await openCard("Open Checkout flow");
    await settled();
    expect(nav.openAppPath).toHaveBeenCalledWith("/plugins/studio/studio/drawings/drw_0123456789abcdef");
  });
});

describe("item headers", () => {
  it("in a workbench, the split button is Open in Studio; elsewhere it splits", async () => {
    await render(<StudioContainerProvider value={thread}><OpenInSplitButton item={{ title: "Q3", href: ARTIFACT }} /></StudioContainerProvider>);
    const button = element.querySelector("button")!;
    expect(button.getAttribute("aria-label")).toBe("Open in Studio");
    await act(async () => button.click());
    expect(workspace.openWorkspaceItem).toHaveBeenCalledWith({ href: ARTIFACT, title: "Q3" });

    await render(<StudioContainerProvider value={studio}><OpenInSplitButton item={{ title: "Q3", href: ARTIFACT }} /></StudioContainerProvider>);
    expect(element.querySelector("button[aria-label]")!.getAttribute("aria-label")).toBe("Open in split");
  });
});

describe("item gestures", () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 40));
  const item = (container: HTMLElement) => {
    const link = document.createElement("a");
    link.href = PAGE; link.textContent = "Release checklist";
    container.append(link);
    return link;
  };

  it("inside a workbench, the menu's Mod-click entry is Open in Studio, not a split", async () => {
    // (A real Mod-click takes the same path; jsdom's clicks aren't trusted, which ItemGestures requires.)
    await render(<><ItemGestures /><StudioContainerProvider value={thread}><span id="inside" /></StudioContainerProvider></>);
    const link = item(element.querySelector("#inside")!.parentElement!);
    await act(async () => { link.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })); await settle(); });
    const entries = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(entries.some((each) => each.textContent?.includes("Open in split"))).toBe(false);
    await act(async () => { entries.find((each) => each.textContent?.includes("Open in Studio"))!.click(); await settle(); });
    expect(workspace.openWorkspaceItem).toHaveBeenCalledWith({ href: PAGE, title: "Release checklist" }, "tab");
  });

  it("right-click Open inside a workbench asks the thread for its tab", async () => {
    await render(<><ItemGestures /><ThreadTabReceiver /><StudioContainerProvider value={thread}><span id="inside" /></StudioContainerProvider></>);
    const link = item(element.querySelector("#inside")!.parentElement!);
    await act(async () => { link.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })); await settle(); });
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items.map((each) => each.textContent?.trim())).toEqual(expect.arrayContaining(["Open", expect.stringContaining("Open in Studio")]));
    await act(async () => { items.find((each) => each.textContent?.trim() === "Open")!.click(); await settle(); });
    expect(sdk.openTab).toHaveBeenCalledWith(studioTab("page", "pg_b", "Release checklist"));
  });
});

describe("mini apps' bb.open", () => {
  it("opens threads, items, bb:// links and app paths through the router, and refuses anything else", () => {
    const open = vi.fn();
    openTarget("thr_abc", open);
    openTarget(PAGE, open);
    openTarget("/projects/p/threads/thr_q", open);
    openTarget("bb://page/pg_b", open);
    expect(open.mock.calls.map(([target]) => (target as { ref: unknown }).ref)).toEqual([{ kind: "conversation", id: "thr_abc" }, { kind: "page", id: "pg_b" }, { kind: "conversation", id: "thr_q" }, { kind: "page", id: "pg_b" }]);
    expect(() => openTarget("https://example.com", open)).toThrow(/bb.open takes/);
    expect(() => openTarget("/settings", open)).toThrow(/bb.open takes/);
  });
});

// Every opener goes through useStudioOpen. These files may still call the
// low-level openers: the helper and the kit's own plumbing, Studio routes
// that aren't items (settings, the Bot pages, Todos, Setup), redirects of old
// addresses, and the global sidebars, which open in the Studio app.
const ALLOWED = new Set([
  "app.tsx",
  "src/ui/studio-open.tsx",
  "src/kit/app/nav.ts", "src/kit/app/workspace.ts", "src/kit/app/move.tsx", "src/kit/app/create-item.ts", "src/kit/app/item-header.tsx", "src/kit/app/studio-item.ts", "src/kit/app/thread-panel.tsx", "src/kit/app/index.ts", "src/kit/app/collection.tsx",
  "src/ui/create-menu.ts", "src/ui/Workspace.tsx", "src/ui/StudioPanel.tsx", "src/ui/StudioSidebar.tsx", "src/ui/ProjectLeads.tsx", "src/ui/QuickOpen.tsx", "src/launcher/ui/CommandPalette.tsx", "src/ui/ItemGestures.tsx",
  "src/ui/health/HealthViews.tsx", "src/ui/thread-header.tsx", "src/ui/thread-context.tsx", "src/ui/studio-tab/StudioTab.tsx",
  "src/ui/bot/workspace.ts", "src/ui/bot/BotPage.tsx", "src/ui/bot/BotAttention.tsx", "src/ui/bot/BotHome.tsx", "src/ui/bot/BotTabs.tsx", "src/ui/bot/BotControls.tsx", "src/ui/bot/BotSidebar.tsx",
  "src/ui/automations/ThreadAutomations.tsx", "src/ui/automations/AutomationsPanel.tsx", "src/settings/ui/sections.tsx", "src/settings/ui/PushSection.tsx",
  "src/design/ui/route.tsx", "src/artifacts/ui/route.tsx", "src/minis/ui/route.tsx", "src/dashboards/ui/route.tsx", "src/draw/ui/route.tsx",
  "src/voice/live/ui/QuickSettings.tsx", "src/loops/ui/hooks.ts", "src/pages/ui/PagesPanel.tsx", "src/talk/ui/recordings-panel.tsx", "src/talk/ui/call-ui.tsx", "src/talk/ui/controller.ts",
  "src/chat/ui/ChatOverlay.tsx", "src/code/file-opener.tsx",
  // The link router's own fallback to the main view.
  "src/links/open.ts",
  // "Studio: Show the Bot" goes to a conversation (a thread): it opens no item.
  "src/ui/conversations/show-bot.ts",
  // A drop on BB's main view opens what was dropped there: that is what the drop means.
  "src/ui/item-drop.ts",
  // A Bot page's header opens the Bot's page, a Studio route, from the Bot's name.
  "src/ui/bot-page/BotPageLayout.tsx",
  "src/ui/bot-page/open-row.ts",
  "src/ui/automations/AutomationTab.tsx",
]);
const LOW_LEVEL = /\b(?:openAppPath|useOpenMain|useOpenThreadTab|openWorkspaceItem)\s*\(/;

it("no other file opens items around the rule", () => {
  const root = resolve(__dirname, "../..");
  const files: string[] = ["app.tsx"];
  const walk = (dir: string) => {
    for (const name of readdirSync(join(root, dir))) {
      const path = join(dir, name);
      if (statSync(join(root, path)).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(path);
    }
  };
  walk("src");
  const offenders = files.filter((file) => !ALLOWED.has(file) && LOW_LEVEL.test(readFileSync(join(root, file), "utf8")));
  expect(offenders.map((file) => relative(".", file))).toEqual([]);
});
