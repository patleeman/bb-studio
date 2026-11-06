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
const { containerAt, planOpen, runPlan, StudioContainerProvider, useStudioOpen, workbenchItem } = await import("./studio-open");
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

it("opens an item in the container you're in, and Mod-click in the other place", () => {
  const tab = { actionId: "studio", title: "Plan", params: { kind: "page", id: "pg_b" } };
  expect(planOpen({ href: PAGE, title: "Plan" }, thread)).toEqual({ via: "workbench", threadId: "thr_a", open: tab, fallback: PAGE });
  expect(planOpen({ href: PAGE, title: "Plan" }, thread, { alternate: true })).toEqual({ via: "studio", href: PAGE, title: "Plan", placement: "tab" });
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
