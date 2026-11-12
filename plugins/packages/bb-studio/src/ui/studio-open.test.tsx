// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ openTab: vi.fn((_options: unknown) => true), toThread: vi.fn(), openUrl: vi.fn((_url: string) => true) }));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  experimental_useAppPanel: () => ({ openTab: state.openTab, getTabs: () => ({ open: false, selectedKey: null, tabs: [] }) }),
  useBbNavigate: () => ({ toThread: state.toThread, openUrl: state.openUrl }),
  useComposer: () => ({ scope: { kind: "thread", threadId: "thr_a" } }),
}));
const nav = vi.hoisted(() => ({ openAppPath: vi.fn() }));
vi.mock("../kit/app/nav", () => ({ openAppPath: nav.openAppPath }));
const workspace = vi.hoisted(() => ({ openWorkspaceItem: vi.fn((_item: unknown, _placement?: unknown) => true) }));
vi.mock("../kit/app/workspace", () => ({ openWorkspaceItem: workspace.openWorkspaceItem }));
const { containerAt, linkRef, openPathIn, planOpen, routeContainer, runPlan, StudioContainerProvider, useStudioOpen, wantsAlternate, workbenchItem, workbenchReturn } = await import("./studio-open");
const { resetThreadTabRequests, ThreadTabReceiver } = await import("../kit/app/thread-panel");

const PAGE = "/plugins/studio/studio/pages/pg_b";
const thread = { kind: "thread" as const, threadId: "thr_a" };
const studio = { kind: "studio" as const };
const deps = () => ({ panel: { openTab: state.openTab }, navigate: { toThread: state.toThread, openUrl: state.openUrl } });

let root: Root, element: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  for (const mock of [state.openTab, state.toThread, state.openUrl, nav.openAppPath, workspace.openWorkspaceItem]) mock.mockReset();
  state.openTab.mockReturnValue(true);
  state.openUrl.mockReturnValue(true);
  workspace.openWorkspaceItem.mockReturnValue(true);
  element = document.createElement("div"); document.body.append(element); root = createRoot(element);
});
afterEach(() => { act(() => root.unmount()); element.remove(); resetThreadTabRequests(); });

it("knows which item paths the workbench can show, old add-on addresses too", () => {
  expect(workbenchItem(PAGE)).toEqual({ kind: "page", id: "pg_b" });
  expect(workbenchItem("/plugins/pages/pages/pg_b")).toEqual({ kind: "page", id: "pg_b" });
  expect(workbenchItem("/plugins/studio/studio/artifacts/art_3f6f5166257e0457")).toEqual({ kind: "artifact", id: "art_3f6f5166257e0457" });
  // A sub-view, a kind with no tab, and an add-on's page stay out.
  expect(workbenchItem(`${PAGE}/chat/thr_x`)).toBeNull();
  expect(workbenchItem("/plugins/studio/studio/workspaces/cws_1")).toBeNull();
  expect(workbenchItem("/plugins/forecast/forecast/f_1")).toBeNull();
});

it("shows the same item from its family address, its own address and a page: reference", () => {
  const design = "dsn_0123456789abcdef";
  const dashboard = "dsh_0123456789abcdef";
  const artifact = "art_3f6f5166257e0457";
  expect(workbenchItem(`/plugins/studio/studio/pages/${design}`)).toEqual({ kind: "design", id: design });
  expect(workbenchItem(`/plugins/studio/studio/designs/${design}`)).toEqual({ kind: "design", id: design });
  expect(workbenchItem(`/plugins/design/designs/${design}`)).toEqual({ kind: "design", id: design });
  expect(workbenchItem(`/plugins/studio/studio/apps/${dashboard}`)).toEqual({ kind: "dashboard", id: dashboard });
  expect(workbenchItem(`/plugins/studio/studio/dashboards/${dashboard}`)).toEqual({ kind: "dashboard", id: dashboard });
  expect(workbenchItem(`/plugins/studio/studio/apps/${artifact}`)).toEqual({ kind: "artifact", id: artifact });
  expect(workbenchItem(`/plugins/studio/studio/apps/${design}`)).toBeNull();
  // `page:<id>` names any page type; in a thread it opens the same workbench tab as the design's own link.
  const ref = linkRef(`page:${design}`);
  expect(ref).toEqual({ href: `/plugins/studio/studio/pages/${design}` });
  const viaFamily = planOpen(ref!, thread);
  expect(viaFamily).toMatchObject({ via: "workbench", open: { params: { kind: "design", id: design } } });
  expect(planOpen({ href: `/plugins/studio/studio/designs/${design}` }, thread)).toMatchObject({ via: "workbench", open: (viaFamily as { open: unknown }).open });
});

it("opens an item in the container you're in, and Mod-click in the other place", () => {
  const tab = { actionId: "studio", title: "Plan", params: { kind: "page", id: "pg_b" } };
  expect(planOpen({ href: PAGE, title: "Plan" }, thread)).toEqual({ via: "workbench", threadId: "thr_a", open: tab, fallback: PAGE });
  expect(planOpen({ href: PAGE, title: "Plan" }, thread, { alternate: true })).toEqual({ via: "studio", href: PAGE, title: "Plan", placement: "tab", beside: true });
  expect(planOpen({ href: PAGE }, studio)).toEqual({ via: "studio", href: PAGE, placement: "tab" });
  expect(planOpen({ href: PAGE }, studio, { alternate: true })).toEqual({ via: "studio", href: PAGE, placement: "right" });
  // No container known (a card outside a provider): try the workbench, as cards always did.
  expect(planOpen({ href: PAGE }, null)).toMatchObject({ via: "workbench", threadId: null });
  // An add-on's page has no in-thread view.
  expect(planOpen({ href: "/plugins/forecast/forecast/f_1" }, thread)).toEqual({ via: "main", href: "/plugins/forecast/forecast/f_1" });
  expect(planOpen({ threadId: "thr_z" }, thread)).toEqual({ via: "thread", threadId: "thr_z", split: false });
  expect(planOpen({ threadId: "thr_z" }, studio, { alternate: true })).toEqual({ via: "thread", threadId: "thr_z", split: true });
  expect(planOpen({ url: "https://example.com" }, thread)).toEqual({ via: "url", url: "https://example.com" });
});

it("runs a plan, falling back to the main view when the workbench declines", () => {
  runPlan(planOpen({ href: PAGE, title: "Plan" }, thread), deps());
  expect(state.openTab).toHaveBeenCalledWith({ tab: { id: "studio", context: { kind: "thread" }, availability: "action" }, title: "Plan", params: { kind: "page", id: "pg_b" } });
  expect(nav.openAppPath).not.toHaveBeenCalled();

  state.openTab.mockReturnValue(false);
  runPlan(planOpen({ href: PAGE }, null), deps());
  expect(nav.openAppPath).toHaveBeenCalledWith(PAGE);

  runPlan(planOpen({ href: PAGE, title: "Plan" }, studio, { alternate: true }), deps());
  expect(workspace.openWorkspaceItem).toHaveBeenCalledWith({ href: PAGE, title: "Plan" }, "right");

  state.openUrl.mockReturnValue(false);
  const popup = vi.spyOn(window, "open").mockReturnValue(null);
  runPlan({ via: "url", url: "https://example.com" }, deps());
  expect(popup).toHaveBeenCalledWith("https://example.com", "_blank", "noopener");
});

it("from outside the thread's view, asks the thread's composer for the tab", async () => {
  await act(async () => root.render(<ThreadTabReceiver />));
  runPlan(planOpen({ href: PAGE }, thread), { panel: null, navigate: deps().navigate });
  await act(async () => {});
  expect(state.openTab).toHaveBeenCalledTimes(1);
  expect(nav.openAppPath).not.toHaveBeenCalled();
});

it("a provider sets the container for the hook and marks it for overlays", async () => {
  let open: ReturnType<typeof useStudioOpen> | null = null;
  const Probe = () => { open = useStudioOpen(); return <span id="probe" />; };
  await act(async () => root.render(<StudioContainerProvider value={thread}><Probe /></StudioContainerProvider>));
  expect(containerAt(element.querySelector("#probe"))).toEqual(thread);
  open!({ href: PAGE });
  expect(state.openTab).toHaveBeenCalledTimes(1);

  await act(async () => root.render(<StudioContainerProvider value={studio}><Probe /></StudioContainerProvider>));
  expect(containerAt(element.querySelector("#probe"))).toEqual(studio);
  open!({ href: PAGE });
  expect(workspace.openWorkspaceItem).toHaveBeenCalledWith({ href: PAGE }, "tab");
  expect(containerAt(document.body)).toBeNull();
});

it("reads the container from what the main view shows, for global surfaces", () => {
  expect(routeContainer("/projects/proj_1/threads/thr_9")).toEqual({ kind: "thread", threadId: "thr_9" });
  expect(routeContainer("/threads/thr_9")).toEqual({ kind: "thread", threadId: "thr_9" });
  expect(routeContainer("/plugins/studio/studio")).toEqual(studio);
  expect(routeContainer("/plugins/studio/studio/pages/pg_b")).toEqual(studio);
  expect(routeContainer("/settings/general")).toBeNull();
  expect(routeContainer("/plugins/forecast/forecast")).toBeNull();
  expect(wantsAlternate({ metaKey: true })).toBe(true);
  expect(wantsAlternate({ ctrlKey: true })).toBe(true);
  expect(wantsAlternate({})).toBe(false);
});

it("parses a link's href: web URLs, in-app paths on this origin, threads and page references", () => {
  expect(linkRef("https://example.com/a", "http://bb.local")).toEqual({ url: "https://example.com/a" });
  expect(linkRef("mailto:a@b.c", "http://bb.local")).toEqual({ url: "mailto:a@b.c" });
  expect(linkRef(`http://bb.local${PAGE}#x`, "http://bb.local")).toEqual({ href: `${PAGE}#x` });
  expect(linkRef(PAGE, "http://bb.local")).toEqual({ href: PAGE });
  expect(linkRef("/projects/p/threads/thr_1", "http://bb.local")).toEqual({ threadId: "thr_1" });
  expect(linkRef("page:pg_b", "http://bb.local")).toEqual({ href: PAGE });
  expect(linkRef("thread:thr_1", "http://bb.local")).toEqual({ threadId: "thr_1" });
  expect(linkRef("javascript:alert(1)", "http://bb.local")).toBeNull();
  expect(linkRef("//evil.example/x", "http://bb.local")).toBeNull();
  expect(linkRef("", "http://bb.local")).toBeNull();
});

it("a header action opens through its own panel, for the thread it sits on", () => {
  const panel = { openTab: vi.fn((_options: unknown) => true) };
  openPathIn({ kind: "thread", threadId: "thr_a" }, PAGE, { title: "Plan", panel });
  expect(panel.openTab).toHaveBeenCalledWith({ tab: { id: "studio", context: { kind: "thread" }, availability: "action" }, title: "Plan", params: { kind: "page", id: "pg_b" } });
  expect(nav.openAppPath).not.toHaveBeenCalled();
});

it('"route" decides at click time: over a thread its workbench, in Studio a Studio tab', async () => {
  let open: ReturnType<typeof useStudioOpen> | null = null;
  const Probe = () => { open = useStudioOpen("route"); return null; };
  await act(async () => root.render(<Probe />));
  window.history.pushState(null, "", "/plugins/studio/studio");
  open!({ href: PAGE });
  expect(workspace.openWorkspaceItem).toHaveBeenCalledWith({ href: PAGE }, "tab");
  window.history.pushState(null, "", "/projects/p/threads/thr_a");
  open!({ href: PAGE });
  expect(state.openTab).toHaveBeenCalledTimes(1);
  window.history.pushState(null, "", "/");
});

it("sends an item reached straight from a thread back to that thread's workbench", () => {
  const planned = planOpen({ href: PAGE }, { kind: "thread", threadId: "thr_a" });
  expect(planned.via).toBe("workbench");
  expect(workbenchReturn("/projects/proj_1/threads/thr_a", PAGE)).toEqual({ threadId: "thr_a", back: "/projects/proj_1/threads/thr_a", open: planned.via === "workbench" ? planned.open : null });
  expect(workbenchReturn("/plugins/studio/studio", PAGE)).toBeNull();
  expect(workbenchReturn(null, PAGE)).toBeNull();
  expect(workbenchReturn("/threads/thr_a", "/plugins/studio/studio/bot")).toBeNull();
});
