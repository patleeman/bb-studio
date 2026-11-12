// @vitest-environment jsdom
// One library for both new tab pages: the Studio app's and the Studio tab in
// a thread's workbench (like PageLayout serves PageView and the side panel).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const page = (id: string, updatedAt: number, starredAt: number | null = null) => ({
  pluginId: "studio", id, kind: "page", title: id, icon: null, projectId: null, parentId: null, createdAt: 0, updatedAt, updatedBy: null,
  preview: null, facts: [], badge: null, thumbnailUrl: null, href: `/p/${id}`, archived: false, template: false, tags: [], thread: null, starredAt,
});
const state = vi.hoisted(() => ({ props: [] as Record<string, any>[], data: null as unknown, rpc: { call: async () => ({ panels: [] }) } }));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  // Stable, as BB's is.
  useRpc: () => state.rpc,
  useBbNavigate: () => ({ toCompose: () => {} }),
  useBbContext: () => ({ projectId: null }),
}));
vi.mock("./use-overview", () => ({ useOverview: () => ({ data: state.data, error: null, refetch: () => {}, setData: () => {} }) }));
vi.mock("../kit/app/index", () => ({
  CollectionPage: (props: Record<string, any>) => { state.props.push(props); return <div data-collection="">{props.filter.toolbar}{props.headerActions}</div>; },
  DropdownMenu: ({ children }: { children: ReactNode }) => children, DropdownMenuContent: () => null, DropdownMenuItem: () => null,
  DropdownMenuLabel: () => null, DropdownMenuSeparator: () => null, DropdownMenuTrigger: ({ children }: { children: ReactNode }) => children,
  EmptyState: () => null, Icon: () => null, ICON_BUTTON: "", PageColumn: ({ children }: { children: ReactNode }) => children,
  itemKey: (item: { pluginId: string; id: string }) => `${item.pluginId}:${item.id}`, openAppPath: () => {}, useProjects: () => [],
}));
vi.mock("../kit/app/use-content-search", () => ({ useContentSearch: () => ({ matches: new Map(), loading: false }) }));
vi.mock("../kit/app/content-search-status", () => ({ ContentSearchStatus: () => null }));
vi.mock("./SearchFreshness", () => ({ SearchFreshness: () => null, useSearchFreshness: () => ({ revision: 0 }) }));
vi.mock("./QueryBar", () => ({ QueryBar: () => null }));
vi.mock("./FilterToolbar", () => ({ FilterToolbar: () => null }));
vi.mock("./create-menu", () => ({ useCreateEntries: () => [], runCreateEntry: () => {}, startsGroup: () => false }));
vi.mock("./Workspace", () => ({ showBrowse: () => {} }));
vi.mock("../talk/ui/unsent-notice", () => ({ UnsentNotice: () => null }));

const { StudioLibrary, StudioPanel, STARRED_EMPTY, THIS_THREAD } = await import("./StudioPanel");

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  state.props = [];
  state.data = { providers: [{ pluginId: "studio", name: "Studio", state: "ready", detail: null, panel: null, kinds: [] }], items: [page("a", 3, 10), page("b", 2), page("c", 1, 30)], tags: [], views: [] };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const last = () => state.props.at(-1)!;
const click = (testId: string) => act(async () => (container.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement).click());
const thread = { threadId: "thr_1", linked: new Set(["studio:b"]), projectId: "proj_1", onOpen: vi.fn(), createItems: [], headerActions: <span data-thread-actions="" /> };

it("in a workbench, shows this thread's items first until the user clears it", async () => {
  await act(async () => root.render(<StudioLibrary thread={thread} />));
  expect(last().leadingGroup).toEqual({ id: THIS_THREAD, label: "This thread", keys: thread.linked });
  expect(last().defaultProjectId).toBe("proj_1");
  expect(container.querySelector("[data-thread-actions]")).not.toBeNull();
  await click("library-this-thread");
  expect(last().leadingGroup).toBeNull();
  await click("library-this-thread");
  expect(last().leadingGroup).not.toBeNull();
  last().handlers.onOpen(page("b", 2));
  expect(thread.onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "b" }));
});

it("in the Studio app, has no thread scope", async () => {
  await act(async () => root.render(<StudioPanel />));
  expect(last().leadingGroup).toBeNull();
  expect(container.querySelector('[data-testid="library-this-thread"]')).toBeNull();
});

it.each([["Studio app", false], ["workbench", true]])("lists starred items newest-starred first in the %s", async (_name, inThread) => {
  await act(async () => root.render(inThread ? <StudioLibrary thread={thread} /> : <StudioLibrary />));
  expect(container.querySelector('[data-testid="library-starred"]')!.textContent).toContain("2");
  await click("library-starred");
  expect(last().items.map((item: { id: string }) => item.id)).toEqual(["c", "a"]);
  expect(last().filter.order).toBe("given");
  expect(last().filter.empty).toBe(STARRED_EMPTY);
  await click("library-starred");
  expect(last().items.map((item: { id: string }) => item.id)).toEqual(["a", "b", "c"]);
  expect(last().filter.order).toBeUndefined();
});

it("is the one library both hosts draw, with no second copy", () => {
  const tab = readFileSync(join(here, "studio-tab/StudioTab.tsx"), "utf8");
  expect(tab).toContain("<StudioLibrary thread={host} />");
  // The tab's own list, chips and rows are gone.
  expect(tab).not.toContain("tabSections");
  expect(tab).not.toContain("function ItemRow");
  expect(tab).not.toContain("function Chip");
  const panel = readFileSync(join(here, "StudioPanel.tsx"), "utf8");
  expect(panel).toMatch(/export function StudioPanel\(\) \{\n {2}return <StudioLibrary \/>;/);
  expect(readFileSync(join(here, "studio-tab/model.ts"), "utf8")).not.toContain("export function tabSections");
});
