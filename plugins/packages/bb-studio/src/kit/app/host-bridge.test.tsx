// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const hostNavigate: { current: Record<string, unknown> } = { current: {} };
const host: { useAppRoute?: () => { pathname: string }; useAppPanes?: () => unknown; useAppTheme?: () => { mode: "light" | "dark"; epoch: number } } = {};
vi.mock("@get-bb/plugin-sdk/app", () => ({ useBbNavigate: () => hostNavigate.current }));
vi.mock("./host-sdk", async (original) => ({
  ...(await original<typeof import("./host-sdk")>()),
  get useHostAppRoute() { return host.useAppRoute ?? null; },
  get useHostAppPanes() { return host.useAppPanes ?? null; },
  get useHostAppTheme() { return host.useAppTheme ?? null; },
}));

import { HostRouteBridge } from "./host-bridge";
import { openAppPath, openAppPathInSplit } from "./nav";
import { usePathname } from "./route";

let root: Root;
let container: HTMLElement;
let route = { pathname: "/threads/thr_1" };
let rerender: () => void = () => {};

function Probe() { return <span>{usePathname()}</span>; }
function shown() { return container.querySelector("span")?.textContent; }
async function mount() {
  await act(async () => { root.render(<><HostRouteBridge /><Probe /></>); });
  rerender = () => root.render(<><HostRouteBridge /><Probe /></>);
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  root = createRoot(container);
  route = { pathname: "/threads/thr_1" };
  hostNavigate.current = {};
  window.history.replaceState({}, "", "/plugins/studio/studio");
});
afterEach(() => {
  act(() => root.unmount());
  delete host.useAppRoute;
  delete host.useAppPanes;
  delete host.useAppTheme;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

it("on a BB with the hooks, reads BB's route without polling and navigates through BB", async () => {
  const toAppPath = vi.fn(() => true);
  hostNavigate.current = { experimental_toAppPath: toAppPath };
  host.useAppRoute = () => route;
  const interval = vi.spyOn(globalThis, "setInterval");
  const pushed = vi.spyOn(window.history, "pushState");
  await mount();
  expect(shown()).toBe("/threads/thr_1");
  expect(interval.mock.calls.filter(([, ms]) => ms === 400)).toHaveLength(0);

  route = { pathname: "/plugins/pages/pages/pg_1" };
  await act(async () => { rerender(); });
  expect(shown()).toBe("/plugins/pages/pages/pg_1");

  openAppPath("/plugins/forecast/forecast/f_1", { split: true });
  expect(toAppPath).toHaveBeenCalledWith("/plugins/forecast/forecast/f_1", { split: true });
  expect(openAppPathInSplit("/plugins/pages/pages/pg_1")).toBe(true);
  expect(toAppPath).toHaveBeenLastCalledWith("/plugins/pages/pages/pg_1", { split: true });
  expect(pushed).not.toHaveBeenCalled();
});

it("falls back to its own navigation when BB declines the path", async () => {
  hostNavigate.current = { experimental_toAppPath: () => false };
  host.useAppRoute = () => route;
  await mount();
  openAppPath("/plugins/forecast/forecast/f_1");
  expect(window.location.pathname).toBe("/plugins/forecast/forecast/f_1");
});

it("on stock BB, keeps following the address bar and rewriting history", async () => {
  const interval = vi.spyOn(globalThis, "setInterval");
  await mount();
  expect(shown()).toBe("/plugins/studio/studio");
  expect(interval.mock.calls.filter(([, ms]) => ms === 400)).toHaveLength(1);
  expect(openAppPathInSplit("/plugins/pages/pages/pg_1")).toBe(false);
  expect(window.location.pathname).toBe("/plugins/studio/studio");
  openAppPath("/plugins/forecast/forecast/f_1", { split: true });
  await act(async () => {});
  expect(shown()).toBe("/plugins/forecast/forecast/f_1");
});

it("goes back to following the address bar when the bridge unmounts", async () => {
  host.useAppRoute = () => route;
  await mount();
  expect(shown()).toBe("/threads/thr_1");
  await act(async () => { root.render(<Probe />); });
  expect(shown()).toBe("/plugins/studio/studio");
});

it("leaves an item's address alone only in a BB pane beside others", async () => {
  const item = "/plugins/studio/studio/pages/pg_1";
  const { isHostSidePane } = await import("./host-panes");
  let panes = { panes: [{ id: "a", path: "/threads/thr_1", focused: false }, { id: "b", path: item, focused: true }], focus: () => true, close: () => true };
  host.useAppPanes = () => panes;
  await mount();
  expect(isHostSidePane(item)).toBe(true);
  expect(isHostSidePane("/plugins/studio/studio/pages/pg_2")).toBe(false);
  panes = { ...panes, panes: [{ id: "b", path: item, focused: true }] };
  await act(async () => { rerender(); });
  expect(isHostSidePane(item)).toBe(false);
  await act(async () => { root.render(<Probe />); });
  expect(isHostSidePane(item)).toBe(false);
});

it("passes on BB's mode and theme counter, and tells listeners only when one changes", async () => {
  const { hostTheme, subscribeHostTheme } = await import("./host-theme");
  let theme: { mode: "light" | "dark"; epoch: number } = { mode: "dark", epoch: 3 };
  host.useAppTheme = () => theme;
  const heard = vi.fn();
  const unsubscribe = subscribeHostTheme(heard);
  await mount();
  expect(hostTheme()).toEqual({ mode: "dark", epoch: 3 });
  expect(heard).toHaveBeenCalledTimes(1);
  await act(async () => { rerender(); });
  expect(heard).toHaveBeenCalledTimes(1);
  theme = { mode: "dark", epoch: 4 };
  await act(async () => { rerender(); });
  expect(hostTheme()).toEqual({ mode: "dark", epoch: 4 });
  expect(heard).toHaveBeenCalledTimes(2);
  await act(async () => { root.render(<Probe />); });
  expect(hostTheme()).toBeNull();
  unsubscribe();
});
