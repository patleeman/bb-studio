// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QuickOpen, toggleQuickOpen } from "./QuickOpen";

const state = vi.hoisted(() => ({ rpc: { call: vi.fn(async (method: string) => method === "overview" ? { providers: [] } : []) } }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ experimental_Icon: () => null, useRpc: () => state.rpc, useBbNavigate: () => ({}), experimental_useAppPanel: () => ({ openTab: () => false }), useBbContext: () => ({ projectId: null }) }));
vi.mock("../kit/app/index", () => ({ Icon: () => null, ItemTile: () => null, cn: (...parts: unknown[]) => parts.filter(Boolean).join(" "), openAppPath: vi.fn(), projectName: () => "", threadLinkId: () => null, useProjects: () => [], useOpenTarget: () => ({ open: vi.fn(), anchor: null }) }));
vi.mock("./SearchFreshness", () => ({ SearchFreshness: () => null, useSearchFreshness: () => ({ revision: 0 }) }));

let container: HTMLDivElement;
let root: Root;
let origin: HTMLButtonElement;
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLElement.prototype.scrollIntoView = vi.fn();
  origin = document.createElement("button"); origin.textContent = "Original control"; document.body.append(origin);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(createElement(QuickOpen)));
  origin.focus();
  await act(async () => { toggleQuickOpen(); await new Promise(resolve => setTimeout(resolve, 20)); });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); origin.remove(); });

it("traps forward and backward Tab, closes from the close control, and restores prior focus", async () => {
  const input = document.querySelector<HTMLInputElement>('[role="combobox"]')!;
  const close = document.querySelector<HTMLButtonElement>('button[aria-label="Close search"]')!;
  expect(input).not.toBeNull();
  expect(document.activeElement).toBe(input);
  await act(async () => { close.focus(); close.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })); });
  expect(document.activeElement).toBe(input);
  await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(close);
  await act(async () => { close.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(origin);
});

it("retains modal focus when a host control stops bubbling focus events", async () => {
  const input = document.querySelector<HTMLInputElement>('[role="combobox"]')!;
  // Native editors can consume focus events before Radix's document listeners.
  input.addEventListener("focusout", event => event.stopPropagation());
  origin.addEventListener("focusin", event => event.stopPropagation());
  await act(async () => { origin.focus(); await Promise.resolve(); });
  expect(document.activeElement).toBe(input);
});

it("lists mini apps and saved files under one Apps heading", async () => {
  const hit = (pluginId: string, id: string, kind: string, score: number) => ({ ref: { pluginId, id }, kind, title: id, snippet: { text: "", ranges: [] }, href: `/x/${id}`, projectId: null, updatedAt: 1, score });
  const results = [hit("artifacts", "art_report", "artifact", 3), hit("pages", "pg_plan", "page", 2), hit("minis", "mini_timer", "mini", 5)];
  state.rpc.call.mockImplementation(async (method: string) => method === "overview" ? { providers: [] } : method === "searchAll" ? results as never : []);
  const input = document.querySelector<HTMLInputElement>('[role="combobox"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "plan");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 200));
  });
  state.rpc.call.mockImplementation(async (method: string) => method === "overview" ? { providers: [] } : []);
  const headings = [...document.querySelectorAll("#studio-quick-open-list > div > p")].map((each) => each.textContent);
  expect(headings).toEqual(["Apps", "page"]);
  expect([...document.querySelectorAll('[role="option"]')].slice(0, 3).map((each) => each.textContent?.slice(0, 10))).toEqual(["mini_timer", "art_report", "pg_planpag"]);
});

it("shows a reply thread as Reply in <conversation>", async () => {
  const thread = { ref: { pluginId: "bb", id: "thr_reply" }, kind: "thread", title: "Main · thread", snippet: { text: "", ranges: [] }, href: "/threads/thr_reply", projectId: null, updatedAt: 1, score: 4 };
  state.rpc.call.mockImplementation(async (method: string) => method === "overview" ? { providers: [] } : method === "searchAll" ? [thread] as never : []);
  const input = document.querySelector<HTMLInputElement>('[role="combobox"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "main");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 200));
  });
  state.rpc.call.mockImplementation(async (method: string) => method === "overview" ? { providers: [] } : []);
  const option = document.querySelector('[role="option"]')!;
  expect(option.textContent).toContain("Reply in Main");
  expect(option.textContent).not.toContain("· thread");
});
