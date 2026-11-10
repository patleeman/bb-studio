// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { BbNavigate, ExperimentalAppPanes } from "@get-bb/plugin-sdk";
import { PluginContext } from "@/components/plugin/plugin-context";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import type { SplitLayout } from "@/lib/split-layout";
import { useAppPanes } from "./fork-app-panes";
import { useBbNavigate } from "./plugin-sdk-hooks";

const THREAD_PATH = "/projects/proj_1/threads/thr_1";
const ITEM_PATH = "/plugins/alpha/items/it_1";

const api: { panes: ExperimentalAppPanes; navigate: BbNavigate | null } = {
  panes: { panes: [], focus: () => false, close: () => false },
  navigate: null,
};

function Harness() {
  api.panes = useAppPanes();
  api.navigate = useBbNavigate();
  const location = useLocation();
  return <div data-testid="path">{location.pathname}</div>;
}

function threadLayout(): SplitLayout {
  return {
    root: {
      type: "pane",
      paneId: "pane_thread",
      content: { kind: "thread", projectId: "proj_1", threadId: "thr_1" },
    },
    focusedPaneId: "pane_thread",
  };
}

function twoPaneLayout(): SplitLayout {
  return {
    root: {
      type: "split",
      dir: "row",
      sizes: [0.5, 0.5],
      children: [
        threadLayout().root,
        {
          type: "pane",
          paneId: "pane_item",
          content: {
            kind: "plugin-panel",
            pluginId: "alpha",
            panelPath: "items",
            subPath: "it_1",
          },
        },
      ],
    },
    focusedPaneId: "pane_thread",
  };
}

function renderHarness(layout: SplitLayout | null) {
  const store = createStore();
  if (layout !== null) store.set(splitLayoutAtom, layout);
  render(
    <Provider store={store}>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[THREAD_PATH]}>
          <PluginContext.Provider value="alpha">
            <Harness />
          </PluginContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>
    </Provider>,
  );
  return store;
}

function summary() {
  return api.panes.panes.map(
    (pane) => `${pane.path}${pane.focused ? "*" : ""}`,
  );
}

function path() {
  return screen.getByTestId("path").textContent;
}

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe("plugin app panes", () => {
  it("opens a plugin page beside a thread, then focuses it instead of opening it twice", () => {
    renderHarness(threadLayout());
    expect(summary()).toEqual([`${THREAD_PATH}*`]);
    act(() => {
      expect(
        api.navigate?.experimental_toAppPath(ITEM_PATH, { split: true }),
      ).toBe(true);
    });
    expect(summary()).toEqual([THREAD_PATH, `${ITEM_PATH}*`]);
    expect(path()).toBe(ITEM_PATH);
    act(() => {
      api.panes.focus(api.panes.panes[0]!.id);
    });
    act(() => {
      api.navigate?.experimental_toAppPath(ITEM_PATH, { split: true });
    });
    expect(summary()).toEqual([THREAD_PATH, `${ITEM_PATH}*`]);
  });

  it("navigates without adding a pane for a route that cannot be one", () => {
    renderHarness(threadLayout());
    act(() => {
      expect(
        api.navigate?.experimental_toAppPath("/settings", { split: true }),
      ).toBe(true);
    });
    expect(path()).toBe("/settings");
    expect(summary()).toEqual([`${THREAD_PATH}*`]);
  });

  it("focuses a pane and moves the main view to its route", () => {
    renderHarness(twoPaneLayout());
    act(() => {
      expect(api.panes.focus("pane_item")).toBe(true);
    });
    expect(summary()).toEqual([THREAD_PATH, `${ITEM_PATH}*`]);
    expect(path()).toBe(ITEM_PATH);
    act(() => {
      expect(api.panes.focus("pane_missing")).toBe(false);
    });
  });

  it("closes the focused pane and falls back to the surviving pane's route", () => {
    renderHarness(twoPaneLayout());
    act(() => {
      api.panes.focus("pane_item");
    });
    act(() => {
      expect(api.panes.close("pane_item")).toBe(true);
    });
    expect(summary()).toEqual([`${THREAD_PATH}*`]);
    expect(path()).toBe(THREAD_PATH);
  });

  it("turns the last pane into the New thread screen, and refuses to close that", () => {
    renderHarness(threadLayout());
    act(() => {
      expect(api.panes.close("pane_thread")).toBe(true);
    });
    expect(summary()).toEqual(["/*"]);
    expect(path()).toBe("/");
    act(() => {
      expect(api.panes.close("pane_thread")).toBe(false);
      expect(api.panes.close("pane_missing")).toBe(false);
    });
  });

  it("reports no panes and refuses actions before the workspace has a layout", () => {
    renderHarness(null);
    expect(summary()).toEqual([]);
    expect(api.panes.focus("pane_thread")).toBe(false);
    expect(api.panes.close("pane_thread")).toBe(false);
  });
});
