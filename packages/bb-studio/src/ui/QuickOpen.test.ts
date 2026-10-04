// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QuickOpen, toggleQuickOpen } from "./QuickOpen";

const state = vi.hoisted(() => ({ rpc: { call: vi.fn(async (method: string) => method === "overview" ? { providers: [] } : []) } }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ experimental_Icon: () => null, useRpc: () => state.rpc, useBbNavigate: () => ({}), useBbContext: () => ({ projectId: null }) }));
vi.mock("@bb-studio/kit/app", () => ({ Icon: () => null, ItemTile: () => null, cn: (...parts: unknown[]) => parts.filter(Boolean).join(" "), openAppPath: vi.fn(), projectName: () => "", threadLinkId: () => null, useProjects: () => [], useOpenTarget: () => ({ open: vi.fn(), anchor: null }) }));
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
