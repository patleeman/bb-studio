// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CommandThreads } from "./command-threads";
import type { CommandThread } from "./command-contract";
const state = vi.hoisted(() => ({ reply: vi.fn(), select: vi.fn(), open: vi.fn() }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ ThreadChat: ({ threadId, variant, messageActions }: any) => React.createElement("button", { "data-native-thread": threadId, "data-variant": variant, onClick: () => messageActions[0].run({ threadId }) }, "Native transcript") }));
vi.mock("@bb-studio/kit/app", () => ({ ItemTile: () => null, Icon: () => null }));
let root: Root, container: HTMLDivElement;
const row = (id: string, status: string, extra: Partial<CommandThread> = {}): CommandThread => ({ id, title: id, status, parentThreadId: null, updatedAt: 1, error: null, ...extra });
const render = (layout: "active" | "grid" | "focus", threads = [row("idle", "idle"), row("active", "active")], selected: string | null = null, leadThreadId: string | null = null) => act(() => root.render(React.createElement(CommandThreads, { spaceId: "space", threads, leadThreadId, layout, selected, onSelect: state.select, onReply: state.reply, onOpen: state.open })));
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
test("active shows every working thread side by side, keeps them after they stop, and adds a pick", () => {
  render("active", [row("idle", "idle"), row("active", "active"), row("busy", "starting")]);
  const shown = () => [...container.querySelectorAll("[data-native-thread]")].map(node => node.getAttribute("data-native-thread")).sort();
  expect(shown()).toEqual(["active", "busy"]);
  expect([...container.querySelectorAll(".channel-switcher-row[data-current]")].map(row => row.textContent)).toHaveLength(2);
  render("active", [row("idle", "idle"), row("active", "idle"), row("busy", "idle")]);
  expect(shown()).toEqual(["active", "busy"]);
  const idle = [...container.querySelectorAll('[aria-label="Space threads"] button')].find(button => button.textContent?.includes("idle"))!;
  act(() => (idle as HTMLButtonElement).click());
  expect(state.select).not.toHaveBeenCalled();
  expect(shown()).toEqual(["active", "busy", "idle"]);
  expect(container.querySelector("[data-channel-thread]")?.getAttribute("data-channel-thread")).toBe("idle");
  act(() => (container.querySelector('[aria-label="Stop showing idle"]') as HTMLButtonElement).click());
  expect(shown()).toEqual(["active", "busy"]);
  render("active", [row("idle", "idle"), row("active", "active"), row("busy", "idle")]);
  expect(shown()).toEqual(["active"]);
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
test("grid puts the lead first, then threads that need input", () => {
  render("grid", [row("idle", "idle", { updatedAt: 9 }), row("ask", "idle", { hasPendingInteraction: true }), row("lead", "idle")], null, "lead");
  expect([...container.querySelectorAll("[data-channel-thread]")].map(pane => pane.getAttribute("data-channel-thread"))).toEqual(["lead", "ask", "idle"]);
  expect(container.querySelector('[data-channel-thread="lead"] [data-command-lead]')?.textContent).toBe("Lead");
  expect(container.querySelector(".channel-unstarted")).toBeNull();
});
test("grid panes rearrange by drag or arrow keys, persist per channel, and reset to attention order", () => {
  localStorage.clear();
  const threads = [row("one", "idle", { updatedAt: 3 }), row("two", "idle", { updatedAt: 2 }), row("three", "idle", { updatedAt: 1 })];
  render("grid", threads);
  const order = () => [...container.querySelectorAll("[data-channel-thread]")].map(pane => pane.getAttribute("data-channel-thread"));
  expect(order()).toEqual(["one", "two", "three"]);
  const pane = (id: string) => container.querySelector(`[data-channel-thread="${id}"]`) as HTMLElement;
  const types: string[] = [];
  const dataTransfer = { types, setData: (type: string) => types.push(type), setDragImage: () => {}, effectAllowed: "", dropEffect: "" };
  const fire = (target: Element, type: string, init: Record<string, unknown> = {}) => act(() => { const event = new Event(type, { bubbles: true, cancelable: true }); Object.assign(event, { dataTransfer, clientX: 0, clientY: 0, ...init }); target.dispatchEvent(event); });
  vi.spyOn(pane("one"), "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
  fire(pane("three").querySelector("header")!, "dragstart");
  fire(pane("one"), "dragover", { clientX: 10 });
  expect(pane("one").getAttribute("data-drop")).toBe("before");
  fire(pane("one"), "drop");
  expect(order()).toEqual(["three", "one", "two"]);
  expect(JSON.parse(localStorage.getItem("studio:command-order:space")!)).toEqual(["three", "one", "two"]);
  act(() => (container.querySelector('[aria-label="Move three"]') as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  expect(order()).toEqual(["one", "three", "two"]);
  expect(container.textContent).toContain("Moved three to position 2 of 3.");
  act(() => (([...container.querySelectorAll("button")].find(button => button.textContent === "Reset order")) as HTMLButtonElement).click());
  expect(order()).toEqual(["one", "two", "three"]);
  expect(localStorage.getItem("studio:command-order:space")).toBeNull();
});
test("panes open on the newest message and follow new ones until the owner scrolls up", () => {
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => { run(); return 0; });
  render("grid", [row("one", "active")]);
  const body = container.querySelector(".channel-pane-body")!, scroller = document.createElement("div");
  scroller.className = "overflow-y-auto";
  let top = 0, height = 1000;
  Object.defineProperties(scroller, { scrollHeight: { get: () => height }, clientHeight: { get: () => 200 }, scrollTop: { get: () => top, set: value => { top = Math.min(value, height - 200); } } });
  // BB mounts its scroller once the thread loads.
  act(() => { body.firstElementChild!.append(scroller); });
  return Promise.resolve().then(() => {
    expect(top).toBe(800);
    height = 1400;
    act(() => { scroller.append(document.createElement("p")); });
    return Promise.resolve();
  }).then(() => {
    expect(top).toBe(1200);
    top = 300;
    scroller.dispatchEvent(new Event("scroll"));
    height = 1800;
    act(() => { scroller.append(document.createElement("p")); });
    return Promise.resolve();
  }).then(() => expect(top).toBe(300));
});
