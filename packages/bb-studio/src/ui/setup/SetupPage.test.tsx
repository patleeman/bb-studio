// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { SetupSummary } from "../../setup-contract";

const setup = vi.hoisted(() => ({
  summary: null as SetupSummary | null, error: null, failures: {} as Record<string, string>, busy: null,
  checkAgain: vi.fn(), install: vi.fn(async () => {}), enable: vi.fn(async () => {}), remove: vi.fn(async () => {}),
}));
vi.mock("./use-setup", () => ({ useSetup: () => setup }));
vi.mock("../health/use-health", () => ({ useHealth: () => ({}) }));
vi.mock("../health/HealthViews", () => ({ ProblemRow: ({ problem }: { problem: { title: string } }) => React.createElement("li", null, problem.title) }));
vi.mock("@bb-studio/kit/ui", () => ({
  Button: ({ variant: _variant, size: _size, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => React.createElement("button", props),
  cn: (...names: unknown[]) => names.filter(Boolean).join(" "),
  Icon: () => null,
}));

const { SetupPage } = await import("./SetupPage");

const summary = (): SetupSummary => ({
  checkedAt: 0, marketplaceAdded: true, marketplaceCommand: "bb marketplace add x",
  addOns: [
    { id: "studio", name: "Studio", summary: "The home.", status: "installed", optional: null, problems: [], passed: [], unanswered: null, command: null },
    { id: "pages", name: "Studio Pages", summary: "Pages.", status: "not-installed", optional: null, problems: [], passed: [], unanswered: null, command: "bb plugin install pages@bb-studio --yes" },
  ],
  retired: [
    { id: "float", name: "Float", enabled: true, why: "Retired.", kept: "Threads.", deleted: "Settings.", before: [], blocker: null, removeCommand: "bb plugin remove float" },
    { id: "studio-chat", name: "Studio Chat", enabled: true, why: "Retired.", kept: "Links.", deleted: "Settings.", before: [{ text: "Migrate.", command: "bb studio-chat migrate" }], blocker: "Run `bb studio-chat migrate`.", removeCommand: "bb plugin remove studio-chat" },
  ],
  commands: ["bb plugin install pages@bb-studio --yes"], installAll: "bb plugin install pages@bb-studio --yes", otherProblems: [],
});

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  setup.summary = summary();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const button = (label: string) => [...container.querySelectorAll("button")].find((each) => each.textContent === label);

test("lists add-ons with their status and command, and installs with one click", async () => {
  act(() => root.render(<SetupPage />));
  expect(container.textContent).toContain("Set up BB Studio");
  expect(container.textContent).toContain("Not installed");
  expect(container.textContent).toContain("bb plugin install pages@bb-studio --yes");
  await act(async () => button("Install all (1)")!.click());
  expect(setup.install).toHaveBeenCalledWith(["pages"], "install-all");
  await act(async () => button("Install")!.click());
  expect(setup.install).toHaveBeenCalledWith(["pages"]);
});

test("removing a retired plugin asks first, and a blocked one can't be removed", async () => {
  act(() => root.render(<SetupPage />));
  const removes = [...container.querySelectorAll("button")].filter((each) => each.textContent === "Remove…");
  expect(removes.map((each) => each.disabled)).toEqual([false, true]);
  expect(container.textContent).toContain("Not yet: Run `bb studio-chat migrate`.");
  await act(async () => removes[0]!.click());
  expect(setup.remove).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Remove Float and delete its settings?");
  await act(async () => button("Remove")!.click());
  expect(setup.remove).toHaveBeenCalledWith("float");
});
