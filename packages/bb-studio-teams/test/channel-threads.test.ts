// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ChannelThreads } from "../channel-threads";
import type { ThreadView, ViewThread } from "../view-contract";
const state = vi.hoisted(() => ({ rpc: { call: vi.fn() }, reply: vi.fn(), select: vi.fn(), open: vi.fn() }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useRpc: () => state.rpc, ThreadChat: ({ threadId, variant, messageActions }: any) => React.createElement("button", { "data-native-thread": threadId, "data-variant": variant, onClick: () => messageActions[0].run({ threadId }) }, "Native transcript") }));
vi.mock("@bb-studio/kit/app", () => ({ ItemTile: () => null, Icon: () => null }));
let root: Root, container: HTMLDivElement;
const row = (id: string, status: string, extra: Partial<ViewThread> = {}): ViewThread => ({ id, title: id, status, botId: null, parentThreadId: null, updatedAt: 1, error: null, ...extra });
const view: ThreadView = { id: "channel", name: "Review", members: [{ kind: "thread", id: "idle" }, { kind: "thread", id: "active" }], archived: false, createdAt: 1, updatedAt: 1 };
const render = (layout: "active" | "grid" | "focus", threads = [row("idle", "idle"), row("active", "active")], selected: string | null = null) => act(() => root.render(React.createElement(ChannelThreads, { view, initialThreads: threads, bots: [], layout, selected, onSelect: state.select, onReply: state.reply, onOpen: state.open })));
beforeEach(() => { vi.clearAllMocks(); state.rpc.call.mockImplementation(() => new Promise(() => {})); vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
test("active view keeps idle members in the rail but only mounts working native transcripts", async () => {
  state.rpc.call.mockResolvedValue([row("idle", "idle"), row("active", "active")]);
  render("active");
  await act(async () => {});
  expect(container.querySelectorAll("[data-native-thread]")).toHaveLength(1);
  expect(container.querySelector("[data-native-thread]")?.getAttribute("data-native-thread")).toBe("active");
  const idle = [...container.querySelectorAll("nav button")].find(button => button.textContent?.includes("idle"))!;
  act(() => (idle as HTMLButtonElement).click());
  expect(state.select).toHaveBeenCalledWith("idle");
  state.rpc.call.mockResolvedValue([row("idle", "idle"), row("active", "idle")]);
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(container.querySelectorAll("[data-native-thread]")).toHaveLength(0);
  expect(container.textContent).toContain("No threads are working right now.");
});
test("native message reply actions address their source thread, and grid folds children behind links", () => {
  render("grid", [row("idle", "idle"), row("active", "active"), row("child", "active", { parentThreadId: "active" })]);
  expect(container.querySelectorAll("[data-native-thread]")).toHaveLength(2);
  act(() => (container.querySelector('[data-native-thread="active"]') as HTMLButtonElement).click());
  expect(state.reply).toHaveBeenCalledWith("active", true);
  const child = [...container.querySelectorAll("footer button")].find(button => button.textContent?.includes("child"))!;
  act(() => (child as HTMLButtonElement).click());
  expect(state.select).toHaveBeenCalledWith("child");
});
test("focus mounts only the selected native transcript", () => {
  render("focus", undefined, "idle");
  expect(container.querySelectorAll("[data-native-thread]")).toHaveLength(1);
  expect(container.querySelector("[data-native-thread]")?.getAttribute("data-native-thread")).toBe("idle");
});
