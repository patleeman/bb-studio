// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MiniView } from "../contract";

vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  experimental_Icon: ({ name }: { name: string }) => React.createElement("i", { "data-icon": name }),
}));
const toast = vi.hoisted(() => ({ message: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { ApprovalBanner } = await import("./approval");

const mini = { id: "mini_1", name: "Weather", pending: ["net:api.example.com"] } as unknown as MiniView;
const prompt = { nonce: "n".repeat(43), notBefore: Date.now() - 1000, expiresAt: Date.now() + 300_000, capabilities: ["net:api.example.com"], versionId: "v1" };

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  for (const each of Object.values(toast)) each.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const dialog = () => document.querySelector("[role=dialog]");
const button = (scope: ParentNode, label: string) => [...scope.querySelectorAll("button")].find((each) => each.textContent?.trim() === label)!;
const settle = (ms = 5) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

async function review(answer: object) {
  const seen: boolean[] = [];
  const call = vi.fn(async (method: string) => {
    if (method !== "minis.requestApproval") return { ok: true };
    seen.push(dialog() !== null);
    return answer;
  });
  await act(async () => root.render(<ApprovalBanner mini={mini} rpc={{ call } as never} />));
  await act(async () => button(container, "Review").click());
  await settle();
  return { call, seen, requests: () => call.mock.calls.filter(([method]) => method === "minis.requestApproval").length };
}

it("asks once and draws no dialog of its own when BB shows its approval dialog", async () => {
  const { call, seen, requests } = await review({ ...prompt, nonce: "host-approval-dialog", host: true });
  // Not before the answer, and not after it: the dialog never mounts.
  expect(seen).toEqual([false]);
  expect(dialog()).toBeNull();
  expect(requests()).toBe(1);
  expect(toast.message).toHaveBeenCalledWith("Answer in BB's dialog.");
  expect(call).not.toHaveBeenCalledWith("minis.approve", expect.anything());
});

it("shows the prompt it asked for, and approves with its nonce after the wait", async () => {
  const { call, requests } = await review(prompt);
  expect(dialog()!.textContent).toContain("net:api.example.com");
  expect(requests()).toBe(1);
  await settle(80);
  await act(async () => button(document, "Approve").click());
  expect(call).toHaveBeenCalledWith("minis.approve", { id: "mini_1", nonce: prompt.nonce, capabilities: ["net:api.example.com"] });
  expect(requests()).toBe(1);
  expect(dialog()).toBeNull();
});

it("says why when asking fails, and shows no dialog", async () => {
  const call = vi.fn(async () => { throw new Error("Open the app in BB first."); });
  await act(async () => root.render(<ApprovalBanner mini={mini} rpc={{ call } as never} />));
  await act(async () => button(container, "Review").click());
  await settle();
  expect(dialog()).toBeNull();
  expect(toast.error).toHaveBeenCalledWith("Open the app in BB first.");
});
