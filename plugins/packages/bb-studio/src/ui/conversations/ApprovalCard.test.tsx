// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import type { ApprovalView } from "../../worker-approvals";

const state = vi.hoisted(() => ({
  approval: null as ApprovalView | null,
  call: vi.fn(async (_method: string, _input: unknown): Promise<unknown> => ({ approval: null })),
  refresh: vi.fn(),
  toThread: vi.fn(),
}));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useBbNavigate: () => ({ toThread: state.toThread }) }));
vi.mock("../live", () => ({
  useLive: () => ({ data: { worker: { threadId: "thr_lead", title: "Fable lead: sidebar rewrite", projectId: null }, approval: state.approval }, error: null, loading: false, refresh: state.refresh }),
  useCall: () => state.call,
}));
vi.mock("../../kit/app/index", () => ({ Icon: () => null }));

import { ApprovalCard } from "./ApprovalCard";

const pending: ApprovalView = { id: "int_push", state: "pending", title: "Run a command", short: "git push --force", lines: ["Command: git push --force", "Cwd: /repo"], decisions: ["deny", "allow_for_session", "allow_once"] };
const props = (attributes: Record<string, string>) => ({ attributes, message: { id: "m", threadId: "conv", turnId: null, projectId: null }, source: "", openWorkspaceFile: () => false }) as unknown as PluginMessageDirectiveProps;

let root: Root;
let host: HTMLDivElement;
const $ = (selector: string) => host.querySelector<HTMLElement>(selector);
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state.approval = pending;
  state.call.mockReset();
  state.toThread.mockClear();
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("shows the worker (opening it), what it asks for with its details, and Deny / Approve for this worker / Approve", async () => {
  await act(async () => { root.render(<ApprovalCard {...props({ thread: "thr_lead", id: "int_push" })} />); });
  expect($('[data-testid="approval-card"]')?.dataset.state).toBe("pending");
  expect($('[data-testid="approval-title"]')?.textContent).toBe("Run a command");
  expect($('[data-testid="approval-lines"]')?.textContent).toBe("Command: git push --force\nCwd: /repo");
  expect([...host.querySelectorAll("footer button")].map((button) => button.textContent)).toEqual(["Deny", "Approve for this worker", "Approve"]);
  await act(async () => { $('[data-testid="approval-worker"]')!.click(); });
  expect(state.toThread).toHaveBeenCalledWith("thr_lead");
});

it("approves through the worker's pending approval, then says Approved", async () => {
  state.call.mockResolvedValueOnce({ approval: { ...pending, state: "approved" } });
  await act(async () => { root.render(<ApprovalCard {...props({ thread: "thr_lead", id: "int_push" })} />); });
  await act(async () => { $('[data-testid="approval-allow_once"]')!.click(); });
  expect(state.call).toHaveBeenCalledWith("bot_worker_approval_resolve", { threadId: "thr_lead", interactionId: "int_push", decision: "allow_once" });
  expect($('[data-testid="approval-settled"]')?.textContent).toBe("Approved");
  expect($("footer")).toBeNull();
});

it("denies, and says why when it doesn't go through", async () => {
  state.call.mockRejectedValueOnce(new Error("That approval isn't waiting any more."));
  await act(async () => { root.render(<ApprovalCard {...props({ thread: "thr_lead", id: "int_push" })} />); });
  await act(async () => { $('[data-testid="approval-deny"]')!.click(); });
  expect(state.call).toHaveBeenCalledWith("bot_worker_approval_resolve", { threadId: "thr_lead", interactionId: "int_push", decision: "deny" });
  expect($('[role="alert"]')?.textContent).toBe("That approval isn't waiting any more.");
  expect(state.refresh).toHaveBeenCalled();
});

it("shows how it was settled when it was resolved elsewhere, and draws nothing for a malformed directive", async () => {
  state.approval = { ...pending, state: "denied" };
  await act(async () => { root.render(<ApprovalCard {...props({ thread: "thr_lead", id: "int_push" })} />); });
  expect($('[data-testid="approval-settled"]')?.textContent).toBe("Denied");
  state.approval = null;
  await act(async () => { root.render(<ApprovalCard {...props({ thread: "thr_lead", id: "int_push" })} />); });
  expect($('[data-testid="approval-settled"]')?.textContent).toBe("No longer waiting");
  await act(async () => { root.render(<ApprovalCard {...props({ thread: "x" })} />); });
  expect(host.innerHTML).toBe("");
});
