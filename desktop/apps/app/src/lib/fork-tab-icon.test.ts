import { describe, expect, it, vi } from "vitest";
import type { PluginTabSlot } from "./plugin-slots";
import { pluginTabInstanceIcon } from "./fork-tab-icon";

function slot(over: Partial<PluginTabSlot>): PluginTabSlot {
  return {
    pluginId: "alpha",
    generation: 1,
    id: "item",
    title: "Item",
    icon: "Box",
    context: { kind: "thread" },
    availability: "action",
    component: () => null,
    ...over,
  } as PluginTabSlot;
}

const tab = {
  pluginId: "alpha",
  actionId: "item",
  paramsJson: '{"kind":"board"}',
};

describe("a plugin tab's instance icon", () => {
  it("comes from the tab's params, and falls back when the plugin gives none or throws", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const byKind = slot({
      experimental_instanceIcon: (params) =>
        (params as { kind?: string } | null)?.kind === "board" ? "Edit" : null,
    });
    expect(pluginTabInstanceIcon(tab, [byKind])).toBe("Edit");
    expect(
      pluginTabInstanceIcon({ ...tab, paramsJson: '{"kind":"page"}' }, [
        byKind,
      ]),
    ).toBeNull();
    expect(pluginTabInstanceIcon(tab, [slot({})])).toBeNull();
    expect(
      pluginTabInstanceIcon(tab, [
        slot({
          experimental_instanceIcon: () => {
            throw new Error("bad");
          },
        }),
      ]),
    ).toBeNull();
    expect(
      pluginTabInstanceIcon(tab, [
        slot({ pluginId: "beta", experimental_instanceIcon: () => "Edit" }),
      ]),
    ).toBeNull();
    vi.restoreAllMocks();
  });
});
