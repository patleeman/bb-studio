// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import type { ApprovalView } from "../../worker-approvals";

type Item = { worker: { threadId: string; title: string; projectId: string | null }; approval: ApprovalView };
const state = vi.hoisted(() => ({
  approvals: [] as Item[],
  single: null as ApprovalView | null,
  listeners: new Set<() => void>(),
  call: vi.fn(async (_method: string, _input: unknown): Promise<unknown> => ({})),
}));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useBbNavigate: () => ({ toThread: vi.fn() }), useBbContext: () => ({ threadId: "conv" }) }));
vi.mock("../live", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useLive: (method: string) => {
      useSyncExternalStore((listener) => { state.listeners.add(listener); return () => { state.listeners.delete(listener); }; }, () => state.approvals);
      return method === "bot_conversation_approvals"
        ? { data: { approvals: state.approvals }, error: null, loading: false, refresh: () => {} }
        : { data: { worker: { threadId: "thr_lead", title: "Fable lead", projectId: null }, approval: state.single }, error: null, loading: false, refresh: () => {} };
    },
    useCall: () => state.call,
  };
});
vi.mock("../../kit/ui/index", async () => (await import("../../loops/ui/test-kit")).kitUi);
vi.mock("../../kit/app/index", () => ({ Icon: () => null }));

import { ConversationApprovals, SETTLED_SHOW_MS } from "./ConversationApprovals";
import { ApprovalCard } from "./ApprovalCard";

const pending = (id: string, title = "Fable lead"): Item => ({ worker: { threadId: `thr_${id}`, title, projectId: null }, approval: { id: `int_${id}`, state: "pending", title: "Run a command", short: "git push", lines: ["Command: git push"], decisions: ["deny", "allow_once"] } });
const setApprovals = (items: Item[]) => { state.approvals = items; for (const listener of state.listeners) listener(); };

let root: Root;
let host: HTMLDivElement;
const $$ = (selector: string) => [...host.querySelectorAll<HTMLElement>(selector)];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state.approvals = [];
  state.call.mockReset();
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("draws nothing while no worker waits, and one card per waiting approval", async () => {
  await act(async () => { root.render(<ConversationApprovals threadId="conv" />); });
  expect(host.innerHTML).toBe("");
  await act(async () => { setApprovals([pending("lead"), pending("codex", "Codex: iOS build")]); });
  expect($$('[data-testid="live-approval"]').map((card) => card.querySelector('[data-testid="approval-worker"]')?.textContent)).toEqual(["Fable lead", "Codex: iOS build"]);
  expect($$('[data-testid="live-approval"] footer button').map((button) => button.textContent)).toEqual(["Deny", "Approve", "Deny", "Approve"]);
});

it("approving resolves the worker's approval, says Approved for a moment, then the card goes", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  state.call.mockResolvedValueOnce({ approval: { ...pending("lead").approval, state: "approved" } });
  await act(async () => { root.render(<ConversationApprovals threadId="conv" />); setApprovals([pending("lead")]); });
  await act(async () => { host.querySelector<HTMLElement>('[data-testid="approval-allow_once"]')!.click(); });
  expect(state.call).toHaveBeenCalledWith("bot_worker_approval_resolve", { threadId: "thr_lead", interactionId: "int_lead", decision: "allow_once" });
  expect(host.querySelector('[data-testid="approval-settled"]')?.textContent).toBe("Approved");
  await act(async () => { setApprovals([]); });
  expect(host.querySelector('[data-testid="approval-settled"]')?.textContent).toBe("Approved");
  await act(async () => { vi.advanceTimersByTime(SETTLED_SHOW_MS); });
  expect(host.innerHTML).toBe("");
});

it("resolved anywhere else: the card says how (asked of BB), then goes", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  state.call.mockResolvedValueOnce({ worker: pending("lead").worker, approval: { ...pending("lead").approval, state: "denied" } });
  await act(async () => { root.render(<ConversationApprovals threadId="conv" />); setApprovals([pending("lead")]); });
  await act(async () => { setApprovals([]); });
  expect(state.call).toHaveBeenCalledWith("bot_worker_approval", { threadId: "thr_lead", interactionId: "int_lead" });
  expect(host.querySelector('[data-testid="approval-settled"]')?.textContent).toBe("Denied");
  await act(async () => { vi.advanceTimersByTime(SETTLED_SHOW_MS); });
  expect(host.innerHTML).toBe("");
});

it("the Bot's line for the same approval offers no second Approve while the live card shows it", async () => {
  state.single = pending("lead").approval;
  const line = { attributes: { thread: "thr_lead", id: "int_lead" }, message: { id: "m", threadId: "conv", turnId: null, projectId: null }, source: "", openWorkspaceFile: () => false } as unknown as PluginMessageDirectiveProps;
  await act(async () => { root.render(<ApprovalCard {...line} />); });
  expect(host.querySelectorAll('[data-testid="approval-card"] footer button')).toHaveLength(2);
  await act(async () => { root.render(<><ConversationApprovals threadId="conv" /><ApprovalCard {...line} /></>); setApprovals([pending("lead")]); });
  expect(host.querySelectorAll('[data-testid="approval-card"] footer button')).toHaveLength(0);
  expect(host.querySelector('[data-testid="approval-card"] [data-testid="approval-note"]')?.textContent).toBe("Answer it at the top of this conversation.");
  expect(host.querySelectorAll('[data-testid="live-approval"] footer button')).toHaveLength(2);
  // Settled: the Bot's line shows how, with no buttons.
  state.single = { ...pending("lead").approval, state: "approved" };
  await act(async () => { setApprovals([]); });
  expect(host.querySelector('[data-testid="approval-card"] [data-testid="approval-settled"]')?.textContent).toBe("Approved");
});
