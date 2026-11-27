// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Notice } from "../contract";

const state = vi.hoisted(() => ({
  notice: null as unknown,
  calls: [] as { method: string; input: unknown }[],
  order: [] as string[],
  selection: null as unknown,
  realtime: null as null | ((payload: unknown) => void),
}));
vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => {
  const composer = {
    scope: { kind: "thread", threadId: "thr_1" },
    setSelection: vi.fn(async (selection: { providerId: string; model: string; permissionMode?: string }) => {
      state.order.push(`select:${selection.providerId}/${selection.model}${selection.permissionMode ? `@${selection.permissionMode}` : ""}`);
      return state.selection ?? selection;
    }),
    submit: vi.fn(async () => { state.order.push("submit"); }),
  };
  const rpc = {
    call: async (method: string, input: unknown) => {
      state.calls.push({ method, input });
      if (method === "router.notice.get") return state.notice;
      if (method === "router.notice.dismiss") { state.order.push("dismiss"); return { ok: true }; }
      if (method === "router.handedOff") { state.order.push("handed-off"); return { cancelledRetries: 1 }; }
      throw new Error(`unexpected ${method}`);
    },
  };
  return {
    ...(await importOriginal<object>()),
    useComposer: () => composer,
    useRpc: () => rpc,
    useRealtime: (_channel: string, handler: (payload: unknown) => void) => { state.realtime = handler; },
  };
});
const { RouterNoticeBanner } = await import("./RouterNotice");

const notice: Notice = {
  threadId: "thr_1",
  requestId: "req_1",
  kind: "usage-limit",
  failedProviderId: "claude-code",
  failedProviderName: "Claude Code",
  reason: "429 rate limit",
  target: { providerId: "acp-opencode", model: "zai/glm-5.3", reasoningLevel: null, label: "GLM 5.3" },
  targetName: "GLM 5.3",
  // The Claude Code thread ran on "auto"; the ACP agent offers no "auto", so the server narrowed it.
  permissionMode: "accept-edits",
  text: "The auto router detected a usage limit on Claude Code (429 rate limit). Hand off to GLM 5.3?",
  createdAt: 1,
};

let root: Root, element: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.notice = notice;
  state.calls = [];
  state.order = [];
  state.selection = null;
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
});
afterEach(() => { act(() => root.unmount()); element.remove(); });

async function render() {
  await act(async () => { root.render(<RouterNoticeBanner />); });
  await act(async () => { await Promise.resolve(); });
}

it("shows the notice for this thread with Hand off and Dismiss", async () => {
  await render();
  expect(state.calls[0]).toEqual({ method: "router.notice.get", input: { threadId: "thr_1" } });
  expect(element.textContent).toContain("The auto router detected a usage limit on Claude Code (429 rate limit). Hand off to GLM 5.3?");
  expect(element.querySelector('[data-testid="router-hand-off"]')?.textContent).toBe("Hand off");
});

it("Hand off picks the model in this composer (BB's handoff), sends, then clears the notice", async () => {
  await render();
  await act(async () => { (element.querySelector('[data-testid="router-hand-off"]') as HTMLButtonElement).click(); });
  await act(async () => { await Promise.resolve(); });
  expect(state.order).toEqual(["select:acp-opencode/zai/glm-5.3@accept-edits", "submit", "handed-off"]);
});

it("doesn't send when the composer can't pick the model", async () => {
  state.selection = { providerId: "claude-code", model: "claude-opus-5-5" };
  await render();
  await act(async () => { (element.querySelector('[data-testid="router-hand-off"]') as HTMLButtonElement).click(); });
  expect(state.order).toEqual(["select:acp-opencode/zai/glm-5.3@accept-edits"]);
  expect(element.querySelector('[role="alert"]')?.textContent).toBe("GLM 5.3 isn't in this composer's model picker.");
});

it("has no Hand off when no model is available, and draws nothing without a notice", async () => {
  state.notice = { ...notice, target: null, targetName: null, text: "No other model." };
  await render();
  expect(element.querySelector('[data-testid="router-hand-off"]')).toBeNull();
  state.notice = null;
  await act(async () => { state.realtime?.({ threadId: "thr_1" }); });
  await act(async () => { await Promise.resolve(); });
  expect(element.querySelector('[data-testid="router-notice"]')).toBeNull();
});

it("auto → ACP: doesn't send when the composer would run the new thread with more access than the notice says", async () => {
  // BB's composer resolves a mode the agent lacks to "full"; Hand off must not send that.
  state.selection = { providerId: "acp-opencode", model: "zai/glm-5.3", permissionMode: "full" };
  await render();
  await act(async () => { (element.querySelector('[data-testid="router-hand-off"]') as HTMLButtonElement).click(); });
  expect(state.order).toEqual(["select:acp-opencode/zai/glm-5.3@accept-edits"]);
  expect(element.querySelector('[role="alert"]')?.textContent).toBe('The composer would hand off with "full" access, not "accept-edits". Nothing was sent.');
});

it("doesn't hand off from a notice that names no mode", async () => {
  state.notice = { ...notice, permissionMode: undefined };
  await render();
  await act(async () => { (element.querySelector('[data-testid="router-hand-off"]') as HTMLButtonElement).click(); });
  expect(state.order).toEqual([]);
  expect(element.querySelector('[role="alert"]')?.textContent).toContain("doesn't say which permission mode");
});
