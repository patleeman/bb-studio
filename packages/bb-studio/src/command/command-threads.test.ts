// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CommandSwitcher, CommandThreads, useCommandPanes } from "./command-threads";
import type { CommandThread } from "./command-contract";
const state = vi.hoisted(() => ({ reply: vi.fn(), select: vi.fn(), open: vi.fn(), seen: vi.fn() }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ ThreadChat: ({ threadId, variant, messageActions }: any) => React.createElement("button", { "data-native-thread": threadId, "data-variant": variant, onClick: () => messageActions[0].run({ threadId }) }, "Native transcript") }));
const tooltips = vi.hoisted(() => [] as unknown[]);
vi.mock("@bb-studio/kit/app", () => ({ ItemTile: () => null, Icon: () => null, Tooltip: ({ label, children }: { label: unknown; children: unknown }) => { tooltips.push(label); return children; } }));
let root: Root, container: HTMLDivElement;
const row = (id: string, status: string, extra: Partial<CommandThread> = {}): CommandThread => ({ id, title: id, status, parentThreadId: null, updatedAt: 1, error: null, ...extra });
function View({ threads, leadThreadId }: { threads: CommandThread[]; leadThreadId: string | null }) {
  const panes = useCommandPanes("space", threads, leadThreadId);
  return React.createElement(React.Fragment, null,
    React.createElement(CommandThreads, { panes, threads, leadThreadId, draftPane: React.createElement("div", { "data-draft": panes.draft?.threadId ?? "composing" }), onReply: state.reply, onSeen: state.seen, onOpen: state.open }),
    React.createElement("button", { "aria-label": "New thread", onClick: panes.newThread }),
    React.createElement("button", { "aria-label": "Started", onClick: () => panes.started("fresh") }),
    React.createElement("button", { "aria-label": "Discard", onClick: panes.discard }),
    React.createElement(CommandSwitcher, { panes, threads, leadThreadId, targets: leadThreadId ? [leadThreadId] : [], onReply: state.reply }),
    React.createElement("button", { "aria-label": "Follow work", onClick: panes.follow }));
}
const render = (threads = [row("idle", "idle"), row("active", "active")], leadThreadId: string | null = null) => act(() => root.render(React.createElement(View, { threads, leadThreadId })));
const shown = () => [...container.querySelectorAll("[data-channel-thread]")].map(pane => pane.getAttribute("data-channel-thread"));
const click = (label: string) => act(() => (container.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).click());
const switcher = (name: string) => act(() => ([...container.querySelectorAll('[aria-label="Space threads"] .channel-switcher-pick')].find(button => button.getAttribute("aria-label")?.startsWith(`${name}, `)) as HTMLButtonElement).click());
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
test("one pane follows the work until the owner opens another thread, which makes a grid", () => {
  render([row("lead", "idle"), row("run", "active"), row("other", "idle")], "lead");
  expect(shown()).toEqual(["run"]);
  expect(container.querySelector("[data-command-following]")).not.toBeNull();
  expect(container.querySelector('[aria-label="Close run"]')).toBeNull();
  render([row("lead", "idle"), row("run", "idle"), row("other", "active")], "lead");
  expect(shown()).toEqual(["other"]);
  switcher("lead");
  expect(shown()).toEqual(["other", "lead"]);
  expect(container.querySelector("[data-command-following]")).toBeNull();
  expect(JSON.parse(localStorage.getItem("studio:command-open:space")!)).toEqual(["other", "lead"]);
  // Opened panes stay put when other threads start working.
  render([row("lead", "idle"), row("run", "active"), row("other", "idle")], "lead");
  expect(shown()).toEqual(["other", "lead"]);
});
test("closing a pane hides it until the thread list opens it again, and closing the last follows the work", () => {
  render([row("lead", "idle"), row("run", "active"), row("other", "idle")], "lead");
  switcher("other");
  switcher("lead");
  expect(shown()).toEqual(["run", "other", "lead"]);
  click("Close other");
  expect(shown()).toEqual(["run", "lead"]);
  expect(container.textContent).toContain("Closed other.");
  switcher("other");
  expect(shown()).toEqual(["run", "lead", "other"]);
  click("Show only lead");
  expect(shown()).toEqual(["lead"]);
  click("Close lead");
  expect(shown()).toEqual(["run"]);
  expect(localStorage.getItem("studio:command-open:space")).toBeNull();
  switcher("lead");
  click("Follow work");
  expect(shown()).toEqual(["run"]);
});
test("the thread list puts the lead first and forks under their parent; fork links open a pane", () => {
  render([row("idle", "idle", { updatedAt: 9 }), row("ask", "idle", { hasPendingInteraction: true }), row("lead", "idle"), row("child", "active", { parentThreadId: "ask" })], "lead");
  expect([...container.querySelectorAll('[aria-label="Space threads"] .channel-switcher-pick')].map(button => button.textContent?.replace(/Lead$/, ""))).toEqual(["lead", "ask", "child", "idle"]);
  // Input requests come ahead of work.
  expect(shown()).toEqual(["ask"]);
  switcher("lead");
  expect(container.querySelector('[data-channel-thread="lead"] [data-command-lead]')?.textContent).toBe("Lead");
  act(() => ([...container.querySelectorAll("footer button")].find(button => button.textContent?.includes("child")) as HTMLButtonElement).click());
  expect(shown()).toEqual(["ask", "lead", "child"]);
});
test("native message reply actions address their source thread", () => {
  render([row("active", "active")]);
  act(() => (container.querySelector('[data-native-thread="active"]') as HTMLButtonElement).click());
  expect(state.reply).toHaveBeenCalledWith("active", true);
});
test("open panes rearrange by drag or arrow keys and keep their order", () => {
  render([row("one", "active"), row("two", "idle"), row("three", "idle")]);
  switcher("two");
  switcher("three");
  expect(shown()).toEqual(["one", "two", "three"]);
  const pane = (id: string) => container.querySelector(`[data-channel-thread="${id}"]`) as HTMLElement;
  const types: string[] = [];
  const dataTransfer = { types, setData: (type: string) => types.push(type), setDragImage: () => {}, effectAllowed: "", dropEffect: "" };
  const fire = (target: Element, type: string, init: Record<string, unknown> = {}) => act(() => { const event = new Event(type, { bubbles: true, cancelable: true }); Object.assign(event, { dataTransfer, clientX: 0, clientY: 0, ...init }); target.dispatchEvent(event); });
  vi.spyOn(pane("one"), "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
  fire(pane("three").querySelector("header")!, "dragstart");
  fire(pane("one"), "dragover", { clientX: 10 });
  expect(pane("one").getAttribute("data-drop")).toBe("before");
  fire(pane("one"), "drop");
  expect(shown()).toEqual(["three", "one", "two"]);
  expect(JSON.parse(localStorage.getItem("studio:command-open:space")!)).toEqual(["three", "one", "two"]);
  act(() => (container.querySelector('[aria-label="Move three"]') as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  expect(shown()).toEqual(["one", "three", "two"]);
  expect(container.textContent).toContain("Moved three to position 2 of 3.");
});
test("panes open on the newest message and follow new ones until the owner scrolls up", () => {
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => { run(); return 0; });
  render([row("one", "active")]);
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
  }).then(() => {
    expect(top).toBe(300);
    // Back at the bottom, it follows again; growth with no upward scroll keeps it there.
    top = height - 200;
    scroller.dispatchEvent(new Event("scroll"));
    height = 2400;
    act(() => { scroller.append(document.createElement("p")); });
    scroller.dispatchEvent(new Event("scroll"));
    height = 2600;
    act(() => { scroller.append(document.createElement("p")); });
    return Promise.resolve();
  }).then(() => expect(top).toBe(2400));
});
test("the thread list checks the open threads", () => {
  render([row("lead", "idle"), row("run", "active")], "lead");
  const checked = () => [...container.querySelectorAll('[aria-label="Space threads"] .channel-switcher-pick[aria-pressed="true"]')].map(button => button.textContent);
  expect(checked()).toEqual(["run"]);
});
test("each row in the thread list sends to its thread, and the recipient's arrow stays lit", () => {
  render([row("lead", "idle"), row("run", "active")], "lead");
  expect(container.querySelector('[aria-label="Send to lead"]')?.getAttribute("aria-pressed")).toBe("true");
  expect(container.querySelector('[aria-label="Send to run"]')?.getAttribute("aria-pressed")).toBe("false");
  click("Send to run");
  expect(state.reply).toHaveBeenCalledWith("run", true);
  // Panes no longer carry their own send button.
  expect(container.querySelector('[data-channel-thread] [aria-label="Send to run"]')).toBeNull();
});
test("controls explain themselves in tooltips, not title attributes", () => {
  tooltips.length = 0;
  render([row("lead", "idle"), row("run", "active"), row("child", "idle", { parentThreadId: "run" })], "lead");
  switcher("lead");
  expect(container.querySelectorAll("[title]")).toHaveLength(0);
  expect(tooltips).toEqual(expect.arrayContaining(["Close the other panes", "Send to run", "Messages go to lead", "Open child", "Close this pane"]));
});
test("a new thread drafts in a pane beside the others and becomes its own pane once the Space lists it", () => {
  const draft = () => container.querySelector("[data-draft]")?.getAttribute("data-draft") ?? null;
  render([row("lead", "idle"), row("run", "active")], "lead");
  click("New thread");
  // The following pane stays, with the draft beside it.
  expect(shown()).toEqual(["run"]);
  expect(draft()).toBe("composing");
  expect(container.querySelector(".channel-thread-stage")?.getAttribute("data-thread-count")).toBe("2");
  click("Discard");
  expect(draft()).toBeNull();
  click("New thread");
  click("Started");
  expect(draft()).toBe("fresh");
  expect(JSON.parse(localStorage.getItem("studio:command-open:space")!)).toEqual(["run", "fresh"]);
  render([row("lead", "idle"), row("run", "active"), row("fresh", "starting")], "lead");
  expect(draft()).toBeNull();
  expect(shown()).toEqual(["run", "fresh"]);
});
test("an unread thread's pane and row stand out until the owner clicks into the pane", () => {
  render([row("lead", "idle"), row("done", "idle", { unread: true })], "lead");
  switcher("done");
  const pane = container.querySelector('[data-channel-thread="done"]') as HTMLElement;
  expect(pane.hasAttribute("data-unread")).toBe(true);
  expect(pane.querySelector("[data-command-unread]")?.textContent).toBe("New");
  expect(container.querySelector('.channel-switcher-row[data-unread] .channel-switcher-pick')?.textContent).toContain("done");
  expect(container.querySelector('[data-channel-thread="lead"]')?.hasAttribute("data-unread")).toBe(false);
  act(() => { pane.querySelector("header")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
  expect(state.seen).toHaveBeenCalledWith("done");
  render([row("lead", "idle"), row("done", "idle", { unread: false })], "lead");
  expect(container.querySelector("[data-unread]")).toBeNull();
  // Read panes don't report again.
  state.seen.mockClear();
  act(() => { (container.querySelector('[data-channel-thread="done"] header') as HTMLElement).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); });
  expect(state.seen).not.toHaveBeenCalled();
});
test("panes and rows show each thread's alias, and the lit arrows follow every addressed thread", () => {
  render([row("lead", "idle", { alias: "a" }), row("run", "active", { alias: "b" })], "lead");
  switcher("lead");
  expect([...container.querySelectorAll("[data-command-panes] [data-command-alias]")].map(e => e.textContent)).toEqual(["b", "a"]);
  expect([...container.querySelectorAll('[aria-label="Space threads"] .channel-alias')].map(e => e.textContent)).toEqual(["a", "b"]);
});
