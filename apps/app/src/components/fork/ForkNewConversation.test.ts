import { describe, expect, it, vi } from "vitest";
import {
  collectPluginAppRegistrations,
  definePluginApp,
} from "@/lib/plugin-app-definition";
import type { PluginNewConversationSlot } from "@/lib/fork-slots";
import { runForkNewConversation } from "./ForkNewConversation";

function slot(
  pluginId: string,
  run: () => boolean,
): PluginNewConversationSlot {
  return { id: "new", pluginId, generation: 0, run };
}

describe("slots.experimental_newConversation", () => {
  it("collects a plugin's new-conversation handler", () => {
    const run = vi.fn(() => true);
    const collected = collectPluginAppRegistrations(
      definePluginApp((app) => {
        app.slots.experimental_newConversation({ id: "bot", run });
      }),
    );
    expect(collected.newConversations).toEqual([{ id: "bot", run }]);
  });

  it("rejects a registration without run", () => {
    expect(() =>
      collectPluginAppRegistrations(
        definePluginApp((app) => {
          app.slots.experimental_newConversation({ id: "bot" } as never);
        }),
      ),
    ).toThrow(/run/u);
  });

  it("lets the plugin start the conversation instead of bb's new-thread page", () => {
    const run = vi.fn(() => true);
    expect(runForkNewConversation([slot("studio", run)])).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("falls back to bb when no plugin handles it or a handler throws", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(runForkNewConversation(undefined)).toBe(false);
    expect(runForkNewConversation([slot("studio", () => false)])).toBe(false);
    expect(
      runForkNewConversation([
        slot("studio", () => {
          throw new Error("no bot");
        }),
      ]),
    ).toBe(false);
    error.mockRestore();
  });

  it("asks plugins in plugin-id order and stops at the first that handles it", () => {
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    expect(runForkNewConversation([slot("zeta", second), slot("alpha", first)])).toBe(true);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });
});
