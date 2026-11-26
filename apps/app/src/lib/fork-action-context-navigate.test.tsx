// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider as JotaiProvider } from "jotai";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, expect, it } from "vitest";
import type { ExperimentalPluginActionContext } from "@get-bb/plugin-sdk";
import { RouteNavigationProvider } from "@/components/ui/app-route-anchor";
import { useAppNavigationHost } from "@/lib/app-navigation-host";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { usePluginActionContextBinder } from "./plugin-navigation-hooks";

afterEach(() => cleanup());

it("gives every bound plugin action context the fork's navigate methods", () => {
  const { queryClient } = createQueryClientTestHarness();
  let context: ExperimentalPluginActionContext | null = null;
  let pathname = "";
  function Probe() {
    const bind = usePluginActionContextBinder();
    const host = useAppNavigationHost();
    context = bind("demo", () => host);
    return null;
  }
  function Location() {
    pathname = useLocation().pathname;
    return null;
  }
  render(
    <QueryClientProvider client={queryClient}>
      <JotaiProvider store={createStore()}>
        <MemoryRouter initialEntries={["/plugins/demo/home"]}>
          <RouteNavigationProvider>
            <Probe />
            <Location />
          </RouteNavigationProvider>
        </MemoryRouter>
      </JotaiProvider>
    </QueryClientProvider>,
  );
  const navigate = context === null ? null : (context as ExperimentalPluginActionContext).navigate;
  if (navigate === null) throw new Error("the binder probe did not render");
  for (const method of [
    navigate.experimental_toAppPath,
    navigate.experimental_popOut,
    navigate.experimental_workbench,
    navigate.experimental_renameTab,
    navigate.experimental_closeFixedTab,
  ]) {
    expect(typeof method).toBe("function");
  }
  let moved = false;
  act(() => {
    moved = navigate.experimental_toAppPath("/settings");
  });
  expect(moved).toBe(true);
  expect(pathname).toBe("/settings");
  expect(navigate.experimental_toAppPath("not-a-path")).toBe(false);
});
