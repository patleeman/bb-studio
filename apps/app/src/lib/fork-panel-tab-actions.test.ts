import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPluginPanelFixedPanelTab,
  createTerminalFixedPanelTab,
} from "./fixed-panel-tabs-state";
import { panelTabActionTarget } from "./fork-panel-tab-actions";

const page = createPluginPanelFixedPanelTab({
  pluginId: "studio",
  actionId: "page",
  paramsJson: '{"page":"p1"}',
  title: "Launch plan",
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the plugin tab a side panel tab carries", () => {
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
