// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  PluginPaletteGroups,
  usePluginPaletteSearch,
  type PluginPaletteRow,
} from "./ForkPaletteSearch";

const chosen: PluginPaletteRow[] = [];
const chosenWithMod: boolean[] = [];

function Harness({ query }: { query: string }) {
  const groups = usePluginPaletteSearch(query);
  const rows = groups.flatMap((group) => group.rows);
  return (
    <div data-testid="groups">
      <PluginPaletteGroups
        groups={groups}
        indexOfRow={(row) => rows.indexOf(row)}
        activeIndex={0}
        optionIdPrefix="opt"
        onSelect={(row, _index, mod) => {
          chosen.push(row);
          chosenWithMod.push(mod);
        }}
        onHighlight={() => {}}
      />
    </div>
  );
}

function text() {
  return screen.getByTestId("groups").textContent;
}

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  chosen.length = 0;
  chosenWithMod.length = 0;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("plugin palette search", () => {
  it("lists each provider's rows under its title and opens the chosen row's route", async () => {
    const search = vi.fn(async (query: string) => [
      {
        id: "pg_1",
        title: `Plan for ${query}`,
        subtitle: "Page",
        path: "/plugins/alpha/items/pg_1",
      },
    ]);
    setPluginSlotRegistrations(
      "alpha",
      makePluginRegistrationSet({
        paletteSearches: [{ id: "items", title: "Alpha items", search }],
      }),
    );
    render(<Harness query="  launch " />);
    expect(text()).toBe("");
    await settle();
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0]?.[0]).toBe("launch");
    expect(text()).toBe("Alpha itemsPlan for launchPage");
    fireEvent.click(screen.getByRole("option"));
    expect(chosen.map((row) => row.path)).toEqual([
      "/plugins/alpha/items/pg_1",
    ]);
  });

  it("carries a row's Mod action and reports a Mod-click, and has none when the plugin gives none", async () => {
    const onMod = vi.fn();
    setPluginSlotRegistrations(
      "alpha",
      makePluginRegistrationSet({
        paletteSearches: [
          {
            id: "items",
            title: "Alpha items",
            search: async () => [
              {
                id: "a",
                title: "With",
                path: "/plugins/alpha/items/a",
                experimental_onModSelect: onMod,
              },
              { id: "b", title: "Without", path: "/plugins/alpha/items/b" },
            ],
          },
        ],
      }),
    );
    render(<Harness query="x" />);
    await settle();
    const [withMod, without] = screen.getAllByRole("option");
    fireEvent.click(withMod!, { metaKey: true });
    fireEvent.click(without!);
    expect(chosenWithMod).toEqual([true, false]);
    expect(chosen[1]?.onModSelect).toBeNull();
    chosen[0]?.onModSelect?.();
    expect(onMod).toHaveBeenCalledTimes(1);
  });

  it("drops rows that are not bb routes, repeat ids and everything past five", async () => {
    setPluginSlotRegistrations(
      "alpha",
      makePluginRegistrationSet({
        paletteSearches: [
          {
            id: "items",
            title: "Alpha items",
            search: async () => [
              { id: "x", title: "Elsewhere", path: "https://evil.example/x" },
              { id: "y", title: "Not a route", path: "/nowhere/y" },
              ...Array.from({ length: 8 }, (_, index) => ({
                id: `it_${index % 7}`,
                title: `Item ${index}`,
                path: `/plugins/alpha/items/it_${index}`,
              })),
            ],
          },
        ],
      }),
    );
    render(<Harness query="item" />);
    await settle();
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Item 0", "Item 1", "Item 2", "Item 3", "Item 4"]);
  });

  it("keeps the other providers when one rejects, and aborts a query the person typed past", async () => {
    const signals: AbortSignal[] = [];
    setPluginSlotRegistrations(
      "alpha",
      makePluginRegistrationSet({
        paletteSearches: [
          {
            id: "broken",
            title: "Broken",
            search: async () => {
              throw new Error("index offline");
            },
          },
          {
            id: "items",
            title: "Alpha items",
            search: async (query, { signal }) => {
              signals.push(signal);
              return [
                {
                  id: "a",
                  title: `Hit ${query}`,
                  path: "/plugins/alpha/items/a",
                },
              ];
            },
          },
        ],
      }),
    );
    const view = render(<Harness query="pla" />);
    await settle();
    expect(text()).toBe("Alpha itemsHit pla");
    view.rerender(<Harness query="plan" />);
    expect(signals[0]?.aborted).toBe(true);
    expect(text()).toBe("");
    await settle();
    expect(text()).toBe("Alpha itemsHit plan");
  });
});
