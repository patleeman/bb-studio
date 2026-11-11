// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  ForkContextCardRows,
  hasForkContextCardRows,
  useForkContextCardOpen,
  usePluginContextCard,
} from "./ForkContextCard";

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
});

function Indicator() {
  const fork = useForkContextCardOpen();
  return (
    <button type="button" onClick={() => fork.wrap(() => {})(false)}>
      {fork.open ? "open" : "closed"}
    </button>
  );
}

function Chip() {
  const card = usePluginContextCard();
  return (
    <button type="button" onClick={card.open}>
      {card.available ? "chip" : "chip (no ring)"}
    </button>
  );
}

describe("plugin rows in the context popover", () => {
  it("draws a plugin's row with its note and runs its action", async () => {
    const run = vi.fn();
    setPluginSlotRegistrations(
      "studio",
      makePluginRegistrationSet({
        contextCardRows: [
          {
            id: "cache",
            useRow: () => ({
              label: "Prompt cache",
              value: "warm 58m",
              note: "A cold send would cost about $1.20.",
              actions: [{ id: "off", label: "Turn warming off", run }],
            }),
          },
          { id: "nothing", useRow: () => null },
        ],
      }),
    );

    render(<ForkContextCardRows />);

    expect(hasForkContextCardRows()).toBe(true);
    expect(screen.getByText("Prompt cache")).toBeTruthy();
    expect(screen.getByText("warm 58m")).toBeTruthy();
    expect(
      screen.getByText("A cold send would cost about $1.20."),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Turn warming off" }));
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("lets a plugin control open the popover only while a context ring is shown, and closes with it", () => {
    const { rerender } = render(<Chip />);
    expect(screen.getByRole("button").textContent).toBe("chip (no ring)");

    rerender(
      <>
        <Chip />
        <Indicator />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "chip" }));
    expect(screen.getByRole("button", { name: "open" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    expect(screen.getByRole("button", { name: "closed" })).toBeTruthy();
  });
});
