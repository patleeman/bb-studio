import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPluginPanelFixedPanelTab,
  createTerminalFixedPanelTab,
} from "./fixed-panel-tabs-state";
import type { PluginPanelTabActionSlot } from "./fork-slots";
import {
  availablePanelTabActions,
  panelTabActionTarget,
  runPanelTabAction,
} from "./fork-panel-tab-actions";

function action(
  overrides: Partial<PluginPanelTabActionSlot> & { pluginId: string },
): PluginPanelTabActionSlot {
  return {
    id: "open",
    title: "Open as main tab",
    generation: 1,
    run: () => {},
    ...overrides,
  };
}

const page = createPluginPanelFixedPanelTab({
  pluginId: "studio",
  actionId: "page",
  paramsJson: '{"page":"p1"}',
  title: "Launch plan",
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the tab a panel tab action is given", () => {
  it("describes a plugin action tab and the thread whose panel holds it", () => {
    expect(panelTabActionTarget(page, "thr_1")).toEqual({
      pluginId: "studio",
      tabId: "page",
      params: { page: "p1" },
      title: "Launch plan",
      threadId: "thr_1",
    });
  });

  it("has no thread on a plugin page, the compose view or outside a workbench", () => {
    for (const stateId of [
      "plugin-panel:studio:library:standalone",
      "root-compose",
      null,
    ]) {
      expect(panelTabActionTarget(page, stateId)?.threadId).toBeNull();
    }
  });

  it("gives params only when they are an object", () => {
    const list = createPluginPanelFixedPanelTab({
      pluginId: "studio",
      actionId: "page",
      paramsJson: "[1,2]",
      title: "List",
    });
    const bare = createPluginPanelFixedPanelTab({
      pluginId: "studio",
      actionId: "page",
      paramsJson: null,
      title: "Bare",
    });
    expect(panelTabActionTarget(list, "thr_1")?.params).toBeUndefined();
    expect(panelTabActionTarget(bare, "thr_1")?.params).toBeUndefined();
  });

  it("is absent for bb's own tabs and for a file opener's tab", () => {
    expect(
      panelTabActionTarget(
        createTerminalFixedPanelTab({ terminalId: "term_1" }),
        "thr_1",
      ),
    ).toBeNull();
    expect(
      panelTabActionTarget(
        {
          ...page,
          fileOpenerOwner: {
            kind: "host-file-preview",
            environmentId: null,
            hostId: "host_1",
            threadId: null,
            tab: { lineRange: null, path: "/notes/plan.md" },
          },
        },
        "thr_1",
      ),
    ).toBeNull();
  });
});

describe("which panel tab actions a tab offers", () => {
  const target = panelTabActionTarget(page, "thr_1")!;

  it("lists actions in plugin order and leaves out the ones that say no or throw", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const offered = availablePanelTabActions(
      [
        action({ pluginId: "zeta" }),
        action({ pluginId: "beta", id: "never", isAvailable: () => false }),
        action({
          pluginId: "beta",
          id: "broken",
          isAvailable: () => {
            throw new Error("boom");
          },
        }),
        action({
          pluginId: "alpha",
          id: "own",
          isAvailable: (tab) => tab.pluginId === "studio",
        }),
      ],
      target,
    );
    expect(offered.map((each) => `${each.pluginId}/${each.id}`)).toEqual([
      "alpha/own",
      "zeta/open",
    ]);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("runs an action with the tab and contains a throw and a rejection", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const run = vi.fn();
    runPanelTabAction(action({ pluginId: "alpha", run }), target);
    expect(run).toHaveBeenCalledWith(target);

    runPanelTabAction(
      action({
        pluginId: "alpha",
        run: () => {
          throw new Error("sync");
        },
      }),
      target,
    );
    runPanelTabAction(
      action({ pluginId: "alpha", run: () => Promise.reject(new Error("no")) }),
      target,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
