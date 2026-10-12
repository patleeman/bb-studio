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
vi.mock("@get-bb/plugin-sdk/app", () => ({ useSdk: () => sdk, useRpc: () => rpc, useRealtime: () => {}, useBbContext: () => ({ projectId: null }) }));
vi.mock("@bb-studio/kit/contract", () => ({ STUDIO_REALTIME_CHANNEL: "x" }));
vi.mock("@bb-studio/kit/app", () => ({
  createStudioItem: vi.fn(), DropdownMenu: passthrough, DropdownMenuContent: passthrough, DropdownMenuItem: passthrough,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => children, Icon: () => null, TagDot: () => null,
  openAppPath: state.openAppPath, usePathname: () => state.pathname, useProjects: () => [],
}));
vi.mock("./StudioPanel", () => ({ showLibrary: state.showLibrary, useLibraryQuery: () => "kind:page" }));
vi.mock("./Workspace", () => ({ useWorkspace: () => ({ focused: "p1", layout: { kind: "pane", id: "p1", tabs: [], active: "/plugins/studio/studio/browse" } }) }));

const { StudioThreadList } = await import("./StudioSidebar");
const props = { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate: () => {}, searchQuery: "" };

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.setPref.mockClear(); state.showLibrary.mockClear(); state.openAppPath.mockClear();
  state.pathname = "/plugins/studio/studio";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); localStorage.clear(); });
const show = async () => { await act(async () => { root.render(<StudioThreadList {...props} />); }); await act(async () => {}); };

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

test("off the Studio page it switches to that page's list and shows a placeholder", async () => {
  state.pathname = "/threads/thr_1";
  await show();
  expect(container.querySelector("nav")).toBeNull();
  expect(state.setPref).toHaveBeenCalledWith({ key: "sidebar.threadListProvider", value: "thread-list/thread-list", expectedRevision: 1 });
});
