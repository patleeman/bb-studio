// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { PluginContext } from "@/components/plugin/plugin-context";
import { useAppRoute } from "./plugin-navigation.fork";
import { useBbNavigate } from "./plugin-sdk-hooks";

const results: boolean[] = [];

function Harness({ target, replace }: { target: string; replace?: boolean }) {
  const route = useAppRoute();
  const pluginNavigate = useBbNavigate();
  const navigate = useNavigate();
  return (
    <div>
      <div data-testid="route">
        {route.pathname}|{route.search}|{route.hash}
      </div>
      <button
        type="button"
        onClick={() =>
          results.push(
            pluginNavigate.experimental_toAppPath(
              target,
              replace ? { replace: true } : undefined,
            ),
          )
        }
      >
        go
      </button>
      <button type="button" onClick={() => void navigate("/settings")}>
        core-navigate
      </button>
      <button type="button" onClick={() => void navigate(-1)}>
        back
      </button>
    </div>
  );
}

function renderHarness(target: string, replace?: boolean) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/", "/plugins/alpha/home"]}>
        <PluginContext.Provider value="alpha">
          <Harness target={target} replace={replace} />
        </PluginContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function route(): string {
  return screen.getByTestId("route").textContent ?? "";
}

afterEach(() => {
  cleanup();
  results.length = 0;
});

describe("plugin app route", () => {
  it("navigates to another plugin's panel and reports the new route", () => {
    renderHarness("/plugins/beta/items/it_1?view=split#top");
    expect(route()).toBe("/plugins/alpha/home||");
    fireEvent.click(screen.getByText("go"));
    expect(results).toEqual([true]);
    expect(route()).toBe("/plugins/beta/items/it_1|?view=split|#top");
    fireEvent.click(screen.getByText("back"));
    expect(route()).toBe("/plugins/alpha/home||");
  });

  it("replaces the current entry so back skips the page being left", () => {
    renderHarness("/plugins/beta/items", true);
    fireEvent.click(screen.getByText("go"));
    expect(route()).toBe("/plugins/beta/items||");
    fireEvent.click(screen.getByText("back"));
    expect(route()).toBe("/||");
  });

  it("follows navigation the plugin did not start", () => {
    renderHarness("/plugins/beta/items");
    fireEvent.click(screen.getByText("core-navigate"));
    expect(route()).toBe("/settings||");
  });

  it.each([
    "plugins/beta/items",
    "//evil.example/plugins/beta/items",
    "https://evil.example/plugins/beta/items",
    "/not-a-bb-route/x",
  ])("refuses %s and stays put", (target) => {
    renderHarness(target);
    fireEvent.click(screen.getByText("go"));
    expect(results).toEqual([false]);
    expect(route()).toBe("/plugins/alpha/home||");
  });
});
