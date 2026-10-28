// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  pathname: "/plugins/studio/studio",
  prefs: { value: "studio/studio-items", revision: 1 },
  setPref: vi.fn(async (_args: unknown) => ({})),
  showLibrary: vi.fn(),
  openAppPath: vi.fn(),
  realtime: {} as Record<string, () => void>,
}));
const kind = (id: string, plural: string) => ({ id, label: id, plural, icon: "File", columns: [], actions: [], create: { mode: "rpc" }, canArchive: true, blurb: "" });
const item = (id: string, updatedAt: number, tags: string[] = []) => ({ id, kind: "page", title: `Item ${id}`, icon: null, projectId: null, parentId: null, createdAt: 0, updatedAt, updatedBy: null, preview: null, facts: [], badge: null, thumbnailUrl: null, href: `/plugins/studio/page/${id}`, archived: false, pluginId: "studio", tags });
const overview = {
  providers: [{ pluginId: "studio", name: "Studio", state: "ready", detail: null, panel: null, kinds: [kind("drawing", "Drawings"), kind("page", "Pages")] }],
  items: [item("a", 1, ["t1"]), item("b", 2)],
  tags: [{ id: "t1", name: "Launch", color: "blue" }],
  views: [{ id: "v1", name: "My pages", query: "kind:page" }],
};
const rpc = { call: vi.fn(async (method: string) => method === "overview" ? overview : { tabs: [] }) };
const sdk = { system: { uiPreferences: {
  list: async () => ({ preferences: { "sidebar.threadListProvider": state.prefs } }),
  set: (args: unknown) => state.setPref(args),
} } };
const passthrough = ({ children }: { children?: React.ReactNode }) => React.createElement("div", null, children);
vi.mock("@get-bb/plugin-sdk/app", () => ({ useSdk: () => sdk, useRpc: () => rpc, useRealtime: (channel: string, callback: () => void) => { state.realtime[channel] = callback; }, useBbContext: () => ({ projectId: null }) }));
vi.mock("../kit/contract", () => ({ STUDIO_REALTIME_CHANNEL: "x" }));
vi.mock("../kit/app/index", () => ({
  DropdownMenu: passthrough, DropdownMenuContent: passthrough, DropdownMenuItem: ({ children }: { children?: React.ReactNode }) => React.createElement("div", { "data-testid": "menu-item" }, children), DropdownMenuSeparator: () => null,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => children, Icon: () => null, TagDot: () => null,
  openAppPath: state.openAppPath, usePathname: () => state.pathname, useProjects: () => [],
}));
vi.mock("./StudioPanel", () => ({ showLibrary: state.showLibrary, useLibraryQuery: () => "kind:page" }));
vi.mock("./Workspace", () => ({ useWorkspace: () => ({ focused: "p1", layout: { kind: "pane", id: "p1", tabs: [], active: "/plugins/studio/studio/browse" } }) }));

const { StudioThreadList } = await import("./StudioSidebar");
const { createEntries } = await import("./create-menu");
const props = { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate: () => {}, searchQuery: "" };

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.setPref.mockClear(); state.showLibrary.mockClear(); state.openAppPath.mockClear();
  state.realtime = {};
  rpc.call.mockReset().mockImplementation(async (method: string) => method === "overview" ? overview : { tabs: [] });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "prerender" });
  state.pathname = "/plugins/studio/studio";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); localStorage.clear(); vi.useRealTimers(); });
const show = async () => { await act(async () => { root.render(<StudioThreadList {...props} />); }); await act(async () => {}); };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

test("on the Studio page it lists kinds, views, tags and recent items, with the library filter selected", async () => {
  await show();
  const kinds = [...container.querySelectorAll('[data-testid="studio-sidebar-kind"]')].map((each) => each.textContent);
  expect(kinds).toEqual(["All items", "Pages2", "Drawings0"]);
  expect(container.querySelector('[data-kind="page"]')!.getAttribute("aria-current")).toBe("page");
  expect(container.textContent).toContain("My pages");
  expect(container.querySelector('[data-testid="studio-sidebar-tag"]')!.textContent).toBe("Launch1");
  expect([...container.querySelectorAll('[data-testid="studio-sidebar-item"]')].map((each) => each.textContent)).toEqual(["Item b", "Item a"]);
  act(() => (container.querySelector('[data-kind="drawing"]') as HTMLButtonElement).click());
  expect(state.showLibrary).toHaveBeenCalledWith("kind:drawing");
  act(() => (container.querySelector('[data-testid="studio-sidebar-item"]') as HTMLButtonElement).click());
  expect(state.openAppPath).toHaveBeenCalledWith("/plugins/studio/page/b");
  expect(state.setPref).not.toHaveBeenCalled();
});

test("New offers the shared create list, Record a call and templates included", async () => {
  const withTalk = { ...overview, providers: [...overview.providers, { pluginId: "talk", name: "Talk", state: "ready", detail: null, panel: null, kinds: [{ ...kind("recording", "Recordings"), label: "Recording", create: { mode: "event", event: "talk:new" } }] }] };
  const templates = [{ pluginId: "studio", id: "pg_t", title: "Weekly" }];
  rpc.call.mockImplementation((async (method: string) => method === "overview" ? withTalk : method === "templates" ? { items: templates } : { tabs: [] }) as never);
  await show();
  await act(async () => {});
  const menu = [...container.querySelectorAll('[data-testid="menu-item"]')].map((each) => each.textContent?.trim());
  expect(menu).toEqual(createEntries(withTalk.providers as never, { templates }).map((entry) => entry.label));
  expect(menu).toEqual(["page", "drawing", "Recording", "Record a call", "From template: Weekly"]);
});

test("off the Studio page it switches to the Bots list and shows a placeholder", async () => {
  state.pathname = "/threads/thr_1";
  await show();
  expect(container.querySelector("nav")).toBeNull();
  expect(state.setPref).toHaveBeenCalledWith({ key: "sidebar.threadListProvider", value: "studio/bot", expectedRevision: 1 });
});

test("a slower sidebar refresh cannot replace a newer result", async () => {
  await show();
  vi.useFakeTimers();
  const oldOverview = deferred<typeof overview>();
  const oldTabs = deferred<{ tabs: [] }>();
  const newOverview = deferred<typeof overview>();
  const newTabs = deferred<{ tabs: [] }>();
  const responses = [oldOverview, oldTabs, newOverview, newTabs];
  let call = 0;
  // New's templates load on their own; only the refreshes race.
  rpc.call.mockImplementation((method: string) => (method === "templates" ? Promise.resolve({ items: [] }) : responses[call++]!.promise) as never);
  const refresh = Object.values(state.realtime)[0]!;

  act(() => refresh());
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  act(() => refresh());
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });

  await act(async () => { newOverview.resolve({ ...overview, items: [item("fresh", 10)] }); newTabs.resolve({ tabs: [] }); });
  expect(container.textContent).toContain("Item fresh");
  await act(async () => { oldOverview.resolve({ ...overview, items: [item("stale", 9)] }); oldTabs.resolve({ tabs: [] }); });
  expect(container.textContent).toContain("Item fresh");
  expect(container.textContent).not.toContain("Item stale");
});

test("shows refresh failures beside retained data and offers retry", async () => {
  await show();
  vi.useFakeTimers();
  rpc.call.mockReset().mockRejectedValue(new Error("offline"));
  const refresh = Object.values(state.realtime)[0]!;
  act(() => refresh());
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(container.textContent).toContain("Item a");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Couldn't load Studio.");
  expect(container.textContent).toContain("Retry");
  act(() => (container.querySelector('[role="alert"] button') as HTMLButtonElement).click());
  await act(async () => {});
  expect(rpc.call).toHaveBeenCalledTimes(4);
});

test("refreshes the sidebar when the window becomes visible again", async () => {
  await show();
  rpc.call.mockClear();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(rpc.call).toHaveBeenCalledTimes(2);
});
