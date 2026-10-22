// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { usePathname } from "./route";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); window.history.replaceState({}, "", "/"); });

it("shares one pathname listener and fallback timer between subscribers", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState({}, "", "/plugins/studio");
  const add = vi.spyOn(window, "addEventListener");
  const remove = vi.spyOn(window, "removeEventListener");
  const interval = vi.spyOn(globalThis, "setInterval");
  const container = document.createElement("div");
  const root = createRoot(container);
  function Probe() { return <span>{usePathname()}</span>; }

  await act(async () => { root.render(<><Probe /><Probe /></>); });
  expect(interval.mock.calls.filter(([_, ms]) => ms === 400)).toHaveLength(1);
  expect(add.mock.calls.filter(([name]) => name === "popstate")).toHaveLength(1);
  expect([...container.querySelectorAll("span")].map((node) => node.textContent)).toEqual(["/plugins/studio", "/plugins/studio"]);

  window.history.pushState({}, "", "/threads/thr_1");
  await act(async () => { window.dispatchEvent(new PopStateEvent("popstate")); });
  expect([...container.querySelectorAll("span")].map((node) => node.textContent)).toEqual(["/threads/thr_1", "/threads/thr_1"]);

  act(() => root.unmount());
  expect(remove.mock.calls.filter(([name]) => name === "popstate")).toHaveLength(1);
});
