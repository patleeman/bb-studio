// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { RestoreResult } from "../../backup-contract";
import type { BackupApi, BackupState } from "./use-backup";

vi.mock("./use-backup", () => ({ useBackup: () => { throw new Error("not used"); } }));
vi.mock("./SetupPage", () => ({ CommandLine: ({ command }: { command: string }) => React.createElement("code", null, command) }));
vi.mock("@bb-studio/kit/ui", () => ({
  Button: ({ variant: _variant, size: _size, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => React.createElement("button", props),
  cn: (...names: unknown[]) => names.filter(Boolean).join(" "),
}));

const { BackupView } = await import("./BackupSection");

const plan: RestoreResult = {
  dryRun: true,
  createdAt: "2026-10-07T10:00:00.000Z",
  sections: [
    { pluginId: "pages", name: "Studio Pages", status: "restored", reason: null, report: { created: 3, updated: 0, unchanged: 1, kept: 1, failed: 0, unmapped: 2, problems: [], notes: [] } },
    { pluginId: "talk", name: "Studio Talk", status: "skipped", reason: "Studio Talk isn't installed here.", report: null },
  ],
  projects: { mapped: 1, unmapped: [{ name: "Old project", path: "/old" }] },
  text: "Dry run: nothing was changed.",
  failed: false,
};

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const api = (state: BackupState): BackupApi => ({ state, backup: vi.fn(async () => {}), plan: vi.fn(async () => {}), confirm: vi.fn(async () => {}), cancel: vi.fn() });
const button = (label: string) => [...container.querySelectorAll("button")].find((each) => each.textContent === label);

test("shows the dry run and restores only when confirmed", async () => {
  const planned = api({ step: "planned", fileName: "b.zip", uploadId: "up_1", plan });
  act(() => root.render(<BackupView api={planned} />));
  expect(container.textContent).toContain("Nothing has changed yet");
  expect(container.textContent).toContain("3 new, 1 already here, 1 kept (newer here), 2 would become global");
  expect(container.textContent).toContain("Studio Talk isn't installed here.");
  expect(container.textContent).toContain("Old project");
  expect(planned.confirm).not.toHaveBeenCalled();
  await act(async () => button("Restore")!.click());
  expect(planned.confirm).toHaveBeenCalled();
  await act(async () => button("Cancel")!.click());
  expect(planned.cancel).toHaveBeenCalled();
});

test("backs up with one click and offers the download again", async () => {
  const idle = api({ step: "idle" });
  act(() => root.render(<BackupView api={idle} />));
  await act(async () => button("Back up")!.click());
  expect(idle.backup).toHaveBeenCalled();
  act(() => root.render(<BackupView api={api({ step: "backed-up", name: "bb-studio-backup-x.zip", bytes: 2048, text: "", href: "/dl" })} />));
  expect(container.querySelector("a")?.getAttribute("href")).toBe("/dl");
  expect(container.textContent).toContain("bb studio backup");
});
