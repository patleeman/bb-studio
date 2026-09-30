import test from "node:test";
import assert from "node:assert/strict";
import type {
  PluginSidebarThread,
  PluginSidebarThreadRowStatus,
} from "@get-bb/plugin-sdk/app";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { directStatusPresentation, directThreadIndicator } from "../direct-status";

const present = (
  indicator: PluginSidebarThread["indicator"],
  hasDraft = false,
  rowStatus: PluginSidebarThreadRowStatus | null = null,
) => directStatusPresentation({ indicator }, hasDraft, rowStatus);

test("direct messages render every host thread indicator", () => {
  const cases: [PluginSidebarThread["indicator"], string, string | null][] = [
    ["unread-error", "Failed", "CircleX"],
    ["waiting-for-input", "Needs input", "CircleQuestion"],
    ["working-draft", "Working · Draft", "Edit"],
    ["workflow", "Workflow", "Workflow"],
    ["background-agent", "Agent running", "UserRoundPlus"],
    ["background-command", "Command running", "Terminal"],
    ["plan-mode", "Plan mode", "ListTodo"],
    ["goal", "Goal active", "Target"],
    ["runtime", "Working", "Loading"],
    ["draft", "Draft", "Edit"],
    ["unread-success", "Unread", null],
    ["queued-failed", "Send failed", "CircleX"],
    ["queued-waiting", "Queued", "Clock"],
    ["none", "Ready", null],
  ];
  for (const [indicator, label, icon] of cases) {
    const status = present(indicator);
    assert.equal(status.shortLabel, label, indicator);
    assert.equal(status.icon, icon, indicator);
  }
});

test("drafts and plugin row status follow thread indicator precedence", () => {
  assert.equal(present("runtime", true).shortLabel, "Working · Draft");
  assert.equal(present("background-agent", true).shortLabel, "Working · Draft");
  assert.equal(present("none", true).shortLabel, "Draft");
  assert.equal(present("unread-success", true).shortLabel, "Unread");
  assert.equal(present("queued-waiting", true).shortLabel, "Queued");
  assert.equal(present("waiting-for-input", true).shortLabel, "Needs input");
  assert.equal(present("unread-error", true).shortLabel, "Failed");

  const editStatus: PluginSidebarThreadRowStatus = {
    icon: "Edit", label: "Edit pending", tone: "running",
  };
  assert.equal(present("none", true, editStatus).shortLabel, "Edit pending");
  assert.equal(present("runtime", false, editStatus).shortLabel, "Working");
  assert.equal(present("waiting-for-input", false, editStatus).shortLabel, "Needs input");
});

const listedThread = (
  overrides: Partial<Parameters<typeof directThreadIndicator>[0]> = {},
): Parameters<typeof directThreadIndicator>[0] => {
  const base = makeThreadResponse({ status: "idle" });
  return {
    ...base,
    activity: {
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activeGoalCount: 0,
      activePlanModeCount: 0,
      activeWorkflowCount: 0,
    },
    hasPendingInteraction: false,
    queuedWork: "none",
    pinSortKey: null,
    environmentBranchName: null,
    environmentHostId: null,
    environmentIsWorktree: null,
    environmentName: null,
    environmentPath: null,
    environmentProviderId: null,
    environmentWorkspaceDisplayKind: "other",
    ...overrides,
  };
};

test("hidden direct threads preserve background work and input status", () => {
  assert.equal(directThreadIndicator(listedThread({
    activity: { ...listedThread().activity, activeBackgroundAgentCount: 1 },
  })), "background-agent");
  assert.equal(directThreadIndicator(listedThread({
    activity: { ...listedThread().activity, activeBackgroundCommandCount: 1 },
  })), "background-command");
  assert.equal(directThreadIndicator(listedThread({
    hasPendingInteraction: true,
    activity: { ...listedThread().activity, activeBackgroundAgentCount: 1 },
  })), "waiting-for-input");
  assert.equal(directThreadIndicator(listedThread({ queuedWork: "waiting" })),
    "queued-waiting");
  assert.equal(directThreadIndicator(listedThread({ queuedWork: "failed" })),
    "queued-failed");
  assert.equal(directThreadIndicator(listedThread({ status: "pending" })), "none");
  assert.equal(present(directThreadIndicator(listedThread({ status: "pending" })), true)
    .shortLabel, "Draft");
  assert.equal(directThreadIndicator(listedThread({
    activity: { ...listedThread().activity, activePlanModeCount: 1 },
    runtime: { ...listedThread().runtime, displayStatus: "active" },
  })), "plan-mode");
});
