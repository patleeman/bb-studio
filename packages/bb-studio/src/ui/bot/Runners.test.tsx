// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RunnerView } from "../../contract";

const state = vi.hoisted(() => ({ call: vi.fn(async (_method: string, _input: unknown) => ({})), check: { warnings: [] as string[], blocked: null as string | null, install: false, providerName: "Codex", machineName: "red4", signInHint: null as string | null } }));
const runner: RunnerView = { id: "r1", name: "Files", job: "Check files", threadId: "t1", state: "active", adopted: false, schedule: { cadence: "daily", time: "09:00" }, nextRunAt: null, lastRunAt: null, lastLevel: null, lastReport: null, lastReportAt: null };
vi.mock("../live", () => ({
  useCall: () => state.call,
  useLive: (method: string) => ({ data: method === "bot_runners" ? { runners: [runner], adoptable: [] } : method === "bot_runner_machines" ? [{ id: "red", name: "red4", connected: true }] : state.check, loading: false, error: null, refresh: () => {} }),
}));
vi.mock("../ProjectLeads", () => ({ HeartbeatFields: () => null, useHeartbeatForm: () => ({ input: () => ({ enabled: true, cadence: "daily", time: "09:00" }) }) }));
vi.mock("./ProviderStatusMark", () => ({ ProviderStatusMark: () => null, runnerStatusTone: () => "idle" }));
vi.mock("../../kit/ui/index", () => {
  const box = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return { Dialog: box, DialogContent: box, DialogHeader: box, DialogFooter: box, DialogTitle: box, DialogDescription: box, Input: (props: object) => <input {...props} />, Icon: () => null };
});
const { RunnersSection, RunnerSidebarRow } = await import("./Runners");
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.call.mockClear();
  Object.assign(state.check, { warnings: [], blocked: null, install: false, signInHint: null });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
const button = (text: string) => [...container.querySelectorAll("button")].find(button => button.textContent === text)!;
const render = () => act(() => root.render(<RunnersSection botId="bot" botName="Dot" disabled={false} onOpen={() => {}} />));
const selectRemote = () => act(() => { const select = container.querySelector("select")!; select.value = "red"; select.dispatchEvent(new Event("change", { bubbles: true })); });

it("offers migration, requires warning confirmation and sends the selected machine", async () => {
  state.check.warnings = ["Missing /Users/patrick/data on red4"];
  render(); act(() => button("Move to machine…").click()); selectRemote();
  expect(container.querySelector("textarea")).toBeNull();
  act(() => button("Move runner").click());
  expect(container.textContent).toContain("Missing /Users/patrick/data on red4");
  expect(state.call).not.toHaveBeenCalled();
  await act(async () => button("Move anyway").click());
  expect(state.call).toHaveBeenCalledWith("bot_runner_migrate", { botId: "bot", id: "r1", machine: "red", confirm: true });
});

it("shows installation and blocks migration until sign-in is ready", async () => {
  state.check.install = true; state.check.blocked = "Install Codex on red4";
  render(); act(() => button("Move to machine…").click()); selectRemote();
  expect(button("Move runner").disabled).toBe(true);
  await act(async () => button("Install Codex on red4").click());
  expect(state.call).toHaveBeenCalledWith("bot_runner_install_provider", { botId: "bot", id: "r1", machine: "red" });
  state.check.install = false; state.check.blocked = "Codex needs sign-in on red4"; state.check.signInHint = "codex login";
  render();
  expect(button("Move runner").disabled).toBe(true);
  expect(container.textContent).toContain("codex login");
});

it("includes a machine picker in Edit and sends the target with the edits", async () => {
  render(); act(() => button("Edit").click()); selectRemote();
  await act(async () => button("Save").click());
  expect(state.call).toHaveBeenCalledWith("bot_runner_update", expect.objectContaining({ botId: "bot", id: "r1", machine: "red" }));
});

it("shows the remote machine and offline state on agenda rows, without a server suffix", () => {
  act(() => root.render(<RunnerSidebarRow agenda botName="Dot" runner={{ ...runner, machineName: "red4", machineOffline: true }} active={false} onOpen={() => {}} providers={[]} />));
  expect(container.textContent).toContain("Files · red4");
  expect(container.textContent).toContain("offline");
  act(() => root.render(<RunnerSidebarRow agenda botName="Dot" runner={runner} active={false} onOpen={() => {}} providers={[]} />));
  expect(container.textContent).toBe("Files");
});
