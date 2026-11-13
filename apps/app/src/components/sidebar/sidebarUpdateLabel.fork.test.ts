import { describe, expect, it } from "vitest";
import type { SidebarUpdateModel, SidebarUpdateRow } from "./sidebar-update-model";
import { sidebarUpdateButtonLabel } from "./SidebarUpdatesBadge";

function provider(label: string): SidebarUpdateRow {
  return {
    kind: "provider",
    key: `provider:${label}`,
    provider: "claude-code" as never,
    label,
    detail: "2.1.1 → 2.1.2",
    state: "available",
    start: null,
  };
}

function plugin(label: string): SidebarUpdateRow {
  return {
    kind: "plugin",
    key: `plugin:${label}`,
    pluginId: label,
    icon: null,
    label,
    detail: "1.0.0 → 1.0.1",
    state: "available",
    startable: true,
  };
}

function model(rows: SidebarUpdateRow[], app = false): SidebarUpdateModel {
  return {
    bb: app
      ? {
          version: "1.0.4",
          currentVersion: "1.0.3",
          installsWhenIdle: false,
          restarting: false,
          restartLabel: null,
        }
      : null,
    rows,
    startableCount: rows.length,
    retryOnly: false,
    updating: false,
  };
}

describe("the footer's update label", () => {
  it("names a single CLI update instead of reading like an app update", () => {
    expect(sidebarUpdateButtonLabel(model([provider("Claude Code")]))).toBe(
      "Claude Code update available",
    );
  });

  it("says what kind of updates wait when there is no app update", () => {
    expect(
      sidebarUpdateButtonLabel(model([provider("Claude Code"), provider("Codex")])),
    ).toBe("2 CLI updates available");
    expect(sidebarUpdateButtonLabel(model([plugin("Git"), plugin("Keep Awake")]))).toBe(
      "2 plugin updates available",
    );
    expect(sidebarUpdateButtonLabel(model([provider("Codex"), plugin("Git")]))).toBe(
      "2 updates available",
    );
  });

  it("keeps the app update in the count", () => {
    expect(sidebarUpdateButtonLabel(model([], true))).toBe("1 update available");
    expect(sidebarUpdateButtonLabel(model([provider("Claude Code")], true))).toBe(
      "2 updates available",
    );
  });
});
