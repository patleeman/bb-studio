// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installTestPluginRuntime, loadPluginApp } from "@get-bb/plugin-sdk/testing/app";
import {
  automationsForThread,
  editPath,
  lastRunLabel,
  nextRunLabel,
  relativeTime,
  scheduleSummary,
  type ThreadAutomation,
} from "./model";
import { AutomationsView } from "./ThreadAutomations";

installTestPluginRuntime();

const NOW = Date.UTC(2026, 9, 8, 12, 0);

function automation(overrides: Record<string, unknown> = {}) {
  return {
    id: "aut_1", projectId: "proj_1", name: "Check inbox", enabled: true,
    trigger: { triggerType: "schedule", cron: "*/30 * * * *", timezone: "UTC" },
    execution: { mode: "agent", prompt: "go", providerId: "p", model: "m", permissionMode: "auto", environment: { type: "project-default" }, targetThreadId: "thr_1" },
    origin: "human", createdByThreadId: null, nextRunAt: NOW + 5 * 60_000, lastRunAt: NOW - 2 * 3_600_000,
    runCount: 3, lastRunStatus: "succeeded", lastRunThreadId: null, lastError: null, createdAt: 0, updatedAt: 0,
    futureField: "kept",
    ...overrides,
  };
}

afterEach(cleanup);

describe("automationsForThread", () => {
  it("keeps only automations targeting the thread and drops unparseable rows", () => {
    const rows = automationsForThread([
      automation(),
      automation({ id: "aut_other", execution: { mode: "agent", targetThreadId: "thr_2" } }),
      automation({ id: "aut_script", execution: { mode: "script", script: "echo" } }),
      { id: "aut_broken", problem: "unreadable" },
      "nonsense",
    ], "thr_1");
    expect(rows.map(r => r.id)).toEqual(["aut_1"]);
    expect((rows[0] as Record<string, unknown>).futureField).toBe("kept");
  });

  it("returns nothing for non-array responses", () => {
    expect(automationsForThread({ error: "x" }, "thr_1")).toEqual([]);
  });

  it("lists enabled automations first, soonest next run first", () => {
    const rows = automationsForThread([
      automation({ id: "paused", enabled: false, nextRunAt: null }),
      automation({ id: "later", nextRunAt: NOW + 3_600_000 }),
      automation({ id: "soon", nextRunAt: NOW + 60_000 }),
    ], "thr_1");
    expect(rows.map(r => r.id)).toEqual(["soon", "later", "paused"]);
  });
});

describe("scheduleSummary", () => {
  const cron = (c: string) => scheduleSummary({ triggerType: "schedule", cron: c }, NOW);
  it.each([
    ["*/30 * * * *", "Every 30 min"],
    ["* * * * *", "Every minute"],
    ["0 * * * *", "Hourly"],
    ["15 * * * *", "Hourly at :15"],
    ["0 */2 * * *", "Every 2 hours"],
    ["0 9 * * *", "Daily 9:00"],
    ["30 9 * * 1-5", "Weekdays 9:30"],
    ["0 10 * * 0,6", "Weekends 10:00"],
    ["0 8 * * 1", "Mon 8:00"],
    ["0 8 * * 1,3,5", "Mon, Wed, Fri 8:00"],
    ["0 9,17 * * *", "Daily 9:00, 17:00"],
    ["0 9 1 * *", "0 9 1 * *"],
    ["@daily", "@daily"],
  ])("%s -> %s", (input, expected) => expect(cron(input)).toBe(expected));

  it("describes one-shot triggers", () => {
    expect(scheduleSummary({ triggerType: "once", runAt: NOW + 3_600_000 }, NOW)).toMatch(/^Once, /);
  });
});

describe("labels", () => {
  it("formats relative times", () => {
    expect(relativeTime(NOW + 5 * 60_000, NOW)).toBe("in 5 min");
    expect(relativeTime(NOW - 2 * 3_600_000, NOW)).toBe("2 h ago");
    expect(relativeTime(NOW + 10_000, NOW)).toBe("now");
  });
  it("describes next and last runs", () => {
    const [row] = automationsForThread([automation()], "thr_1") as [ThreadAutomation];
    expect(nextRunLabel(row, NOW)).toBe("Next in 5 min");
    expect(nextRunLabel({ ...row, enabled: false }, NOW)).toBe("Paused");
    expect(lastRunLabel(row, NOW)).toBe("Last ok 2 h ago");
    expect(lastRunLabel({ ...row, lastRunAt: null, lastRunStatus: null }, NOW)).toBeNull();
    expect(editPath(row)).toBe("/plugins/automations/automations/proj_1/aut_1/edit");
  });
});

describe("AutomationsView", () => {
  it("shows the empty state", () => {
    render(<AutomationsView state={{ kind: "ready", rows: [] }} onToggle={() => {}} now={NOW} />);
    expect(screen.getByText("Nothing wakes this thread on a schedule.")).toBeTruthy();
  });

  it("shows a degraded state when the automations plugin is unreachable", () => {
    render(<AutomationsView state={{ kind: "unavailable", message: "plugin disabled" }} onToggle={() => {}} now={NOW} />);
    expect(screen.getByRole("status").textContent).toMatch(/Automations are unavailable/);
  });

  it("renders rows with schedule, next run, failure and a switch", () => {
    const rows = automationsForThread([
      automation(),
      automation({ id: "aut_2", name: "Nightly report", trigger: { triggerType: "schedule", cron: "0 9 * * 1-5", timezone: "UTC" }, lastRunStatus: "failed", lastError: "provider timed out" }),
    ], "thr_1");
    const onToggle = vi.fn();
    render(<AutomationsView state={{ kind: "ready", rows }} onToggle={onToggle} now={NOW} />);
    expect(screen.getByText("Every 30 min")).toBeTruthy();
    expect(screen.getByText("Weekdays 9:00")).toBeTruthy();
    expect(screen.getAllByText("Next in 5 min")).toHaveLength(2);
    expect(screen.getByText("provider timed out")).toBeTruthy();
    const toggle = screen.getByRole("switch", { name: "Pause Check inbox" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: "aut_1" }), false);
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(2);
  });
});

describe("registration", () => {
  it("registers the Automations thread panel tab", async () => {
    const app = await loadPluginApp(() => import("../../../app"));
    const tabs = (app as unknown as { threadPanelActions?: Array<{ id: string; title: string }> }).threadPanelActions ?? [];
    expect(tabs.map(t => t.title)).toContain("Automations");
  });
});
