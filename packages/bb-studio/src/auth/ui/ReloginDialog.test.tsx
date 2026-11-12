// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import type { LoginSession } from "../contract";

vi.mock("../../kit/ui/hooks/use-compact-viewport.js", () => ({ useIsCompactViewport: () => false }));
vi.mock("../../kit/ui/hooks/use-pointer-coarse.js", () => ({ usePointerCoarse: () => false }));
vi.mock("../../ui/live", () => ({ useCall: () => async () => ({}), useLive: () => ({ data: null }) }));

const { ReloginDialog, statusText } = await import("./ReloginDialog");
const { authNeeds } = await import("./needs");
const { closeRelogin } = await import("./relogin-store");

installTestPluginRuntime();

const session = (over: Partial<LoginSession> = {}): LoginSession => ({ sessionId: "s1", targetId: "pool:aaaa", name: "Codex", flow: "device", url: "https://auth.example.test/codex/device", code: "ABCD-1234", acceptsCode: false, expiresAt: null, pollMs: 1000, state: "waiting", message: null, ...over });
const target = { id: "pool:aaaa", name: "Codex", detail: "Account Pooler · work" };

function harness(first: LoginSession | Error, polls: LoginSession[] = []) {
  const api = {
    start: vi.fn(async () => { if (first instanceof Error) throw first; return first; }),
    poll: vi.fn(async () => polls.shift() ?? session()),
    complete: vi.fn(async (_id: string, _code: string) => session({ state: "saved", flow: "browser", code: null })),
    cancel: vi.fn(async () => ({ cancelled: true })),
  };
  const env = { openUrl: vi.fn(), copy: vi.fn(async () => {}), saved: vi.fn(), closeDelayMs: 500 };
  const onClose = vi.fn();
  return { api, env, onClose };
}

let root: Root | null = null;
const q = (id: string) => document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
async function mount(h: ReturnType<typeof harness>, to: { id: string; name: string; detail: string | null } = target) {
  root = createRoot(document.createElement("div"));
  await act(async () => { root!.render(<ReloginDialog target={to} api={h.api} onClose={h.onClose} env={h.env} />); });
  await flush();
}

beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.useFakeTimers(); });
afterEach(() => { if (root) act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals(); closeRelogin(); });

it("shows the Codex code and link, copies the code and opens the browser", async () => {
  const h = harness(session());
  await mount(h);
  expect(h.api.start).toHaveBeenCalledWith("pool:aaaa");
  expect(q("relogin-dialog")?.getAttribute("data-bb-portaled-overlay")).toBe("");
  expect(q("relogin-code")?.textContent).toBe("ABCD-1234");
  expect(q("relogin-url")?.textContent).toBe("https://auth.example.test/codex/device");
  expect(q("relogin-status")?.textContent).toBe("Waiting for sign-in");
  expect(q("relogin-paste")).toBeNull();
  expect(h.env.openUrl).not.toHaveBeenCalled();

  await act(async () => { q("relogin-copy")!.click(); });
  expect(h.env.copy).toHaveBeenCalledWith("ABCD-1234");
  expect(q("relogin-copy")?.textContent).toBe("Copied");
  await act(async () => { vi.advanceTimersByTime(2000); });
  expect(q("relogin-copy")?.textContent).toBe("Copy code");

  await act(async () => { q("relogin-open")!.click(); });
  expect(h.env.openUrl).toHaveBeenCalledWith("https://auth.example.test/codex/device");
});

it("polls until saved, then confirms and closes", async () => {
  const h = harness(session(), [session(), session({ state: "saved" })]);
  await mount(h);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(h.api.poll).toHaveBeenCalledTimes(1);
  expect(q("relogin-code")).not.toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(h.api.poll).toHaveBeenCalledTimes(2);
  expect(q("relogin-status")?.textContent).toBe("Signed in");
  expect(q("relogin-code")).toBeNull();
  expect(h.env.saved).toHaveBeenCalledWith("Codex");
  expect(h.onClose).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(h.onClose).toHaveBeenCalledOnce();
  expect(h.api.poll).toHaveBeenCalledTimes(2);
  act(() => root?.unmount());
  root = null;
  expect(h.api.cancel).not.toHaveBeenCalled();
});

it("shows an expired code and a failure, and starts again", async () => {
  const h = harness(session(), [session({ state: "expired", message: "Code expired, start again." })]);
  await mount(h);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(q("relogin")?.getAttribute("data-auth-state")).toBe("expired");
  expect(q("relogin-status")?.textContent).toBe("Code expired, start again.");
  expect(q("relogin-code")).toBeNull();
  await act(async () => { q("relogin-retry")!.click(); });
  await flush();
  expect(h.api.start).toHaveBeenCalledTimes(2);
  expect(q("relogin-code")?.textContent).toBe("ABCD-1234");

  expect(statusText(session({ state: "failed" }), null)).toBe("Sign-in failed");
  expect(statusText(null, null)).toBe("Starting");
});

it("shows a start error with Try again", async () => {
  const h = harness(new Error("Account Pooler is off."));
  await mount(h);
  expect(q("relogin")?.getAttribute("data-auth-state")).toBe("failed");
  expect(q("relogin-status")?.textContent).toBe("Account Pooler is off.");
  expect(q("relogin-retry")).not.toBeNull();
});

it("opens the Claude browser login once and submits a pasted code", async () => {
  const claude = { id: "pool:cccc", name: "Claude", detail: null };
  const h = harness(session({ targetId: "pool:cccc", name: "Claude", flow: "browser", code: null, acceptsCode: true, url: "https://login.example.test/oauth/authorize?state=xyz" }));
  await mount(h, claude);
  expect(h.env.openUrl).toHaveBeenCalledTimes(1);
  expect(q("relogin-code")).toBeNull();
  expect(q("relogin-copy")?.textContent).toBe("Copy link");
  const input = q("relogin-paste")!.querySelector("input")!;
  const submit = q("relogin-paste")!.querySelector("button")!;
  expect(submit.disabled).toBe(true);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, " part#state ");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { submit.click(); });
  await flush();
  expect(h.api.complete).toHaveBeenCalledWith("s1", "part#state");
  expect(q("relogin-status")?.textContent).toBe("Signed in");
  expect(document.body.textContent).not.toContain("part#state");
  expect(h.env.openUrl).toHaveBeenCalledTimes(1);
});

it("cancels an open session when closed", async () => {
  const h = harness(session());
  await mount(h);
  act(() => root?.unmount());
  root = null;
  expect(h.api.cancel).toHaveBeenCalledWith("s1");
});

it("makes one Needs you item per signed-out entry and none once signed in", () => {
  const open = vi.fn();
  const entry = { id: "pool:aaaa", source: "pool" as const, provider: "codex", name: "Codex", detail: "work", signedOut: true, reason: "expired" as const };
  const local = { id: "provider:claude-code", source: "provider" as const, provider: "claude", name: "Claude Code", detail: null, signedOut: true, reason: "signed_out" as const };
  const needs = authNeeds({ entries: [entry, { ...entry }, local, { ...local, id: "provider:codex", signedOut: false, reason: null }] }, open);
  expect(needs.map((need) => [need.key, need.title, need.detail, need.action.label])).toEqual([
    ["auth:pool:aaaa", "Codex signed out", "Account Pooler · work", "Sign in again"],
    ["auth:provider:claude-code", "Claude Code signed out", null, "Sign in again"],
  ]);
  needs[0]!.action.run();
  expect(open).toHaveBeenCalledWith({ id: "pool:aaaa", name: "Codex", detail: "Account Pooler · work" });
  expect(authNeeds({ entries: [{ ...entry, signedOut: false, reason: null }] }, open)).toEqual([]);
  expect(authNeeds(null)).toEqual([]);
  expect(authNeeds({ entries: undefined as never })).toEqual([]);
});
