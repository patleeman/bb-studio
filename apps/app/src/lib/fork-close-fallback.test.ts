// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeFallbackApplies,
  closeFallbackHandled,
  readClosePanelState,
  runCloseFallbacks,
} from "./fork-close-fallback";
import type { PluginCloseFallbackSlot } from "./fork-slots";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "./plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";

function mount(options: { closable: boolean; hidden?: boolean }): {
  panelButton: HTMLElement;
  mainButton: HTMLElement;
} {
  document.body.innerHTML = `
    <main><button id="main-button">Reply</button></main>
    <aside ${options.hidden === true ? 'aria-hidden="true"' : ""}>
      <div data-testid="thread-secondary-panel-top-chrome">
        <div data-tab-pill="">
          <button aria-pressed="false">Other</button>
          <button data-tab-pill-close="">x</button>
        </div>
        <div data-tab-pill="">
          <button aria-pressed="true">Selected</button>
          ${options.closable ? '<button data-tab-pill-close="">x</button>' : ""}
        </div>
      </div>
      <button id="panel-button">Inside</button>
    </aside>`;
  return {
    panelButton: document.querySelector<HTMLElement>("#panel-button")!,
    mainButton: document.querySelector<HTMLElement>("#main-button")!,
  };
}

function fallback(
  pluginId: string,
  close: () => boolean,
): PluginCloseFallbackSlot {
  return { pluginId, id: "close", generation: 1, close };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  await Promise.resolve();
  resetPluginSlotStoreForTest();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("where Mod+W goes", () => {
  it.each([
    { focus: "panel", closable: true, hidden: false, applies: false },
    { focus: "panel", closable: false, hidden: false, applies: true },
    { focus: "main", closable: true, hidden: false, applies: true },
    { focus: "main", closable: false, hidden: false, applies: true },
    { focus: "none", closable: true, hidden: false, applies: true },
    { focus: "panel", closable: true, hidden: true, applies: true },
  ] as const)(
    "focus $focus, closable tab $closable, hidden $hidden: fallback $applies",
    ({ focus, closable, hidden, applies }) => {
      const dom = mount({ closable, hidden });
      if (focus === "panel") dom.panelButton.focus();
      if (focus === "main") dom.mainButton.focus();
      expect(closeFallbackApplies(readClosePanelState(document))).toBe(applies);
    },
  );
});

describe("runCloseFallbacks", () => {
  it("asks in plugin-id order and stops at the first that closes something", () => {
    const asked: string[] = [];
    const make = (pluginId: string, result: boolean) =>
      fallback(pluginId, () => {
        asked.push(pluginId);
        return result;
      });
    expect(
      runCloseFallbacks([
        make("zeta", true),
        make("beta", true),
        make("alpha", false),
      ]),
    ).toBe(true);
    expect(asked).toEqual(["alpha", "beta"]);
  });

  it("is false with no handler, and a throwing handler does not stop the next", () => {
    expect(runCloseFallbacks([])).toBe(false);
    const next = vi.fn(() => true);
    expect(
      runCloseFallbacks([
        fallback("alpha", () => {
          throw new Error("bad");
        }),
        fallback("beta", next),
      ]),
    ).toBe(true);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("closeFallbackHandled", () => {
  function register(close: () => boolean) {
    setPluginSlotRegistrations(
      "studio",
      makePluginRegistrationSet({ closeFallbacks: [{ id: "tab", close }] }),
    );
  }

  it("leaves bb to close the selected side tab when focus is in the panel", () => {
    const close = vi.fn(() => true);
    register(close);
    mount({ closable: true }).panelButton.focus();
    expect(closeFallbackHandled()).toBe(false);
    expect(close).not.toHaveBeenCalled();
  });

  it("asks plugins once per key press however many of bb's handlers consult it", async () => {
    const close = vi.fn(() => true);
    register(close);
    mount({ closable: true }).mainButton.focus();
    expect(closeFallbackHandled()).toBe(true);
    expect(closeFallbackHandled()).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(closeFallbackHandled()).toBe(true);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("falls through to bb when no plugin closes anything", () => {
    register(() => false);
    mount({ closable: true }).mainButton.focus();
    expect(closeFallbackHandled()).toBe(false);
  });
});
