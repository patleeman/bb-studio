// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@get-bb/plugin-sdk/app", () => ({ useRpc: () => ({}), useBbNavigate: () => ({}), experimental_useAppPanel: () => ({}), experimental_Icon: () => null }));
vi.mock("./live", () => ({ useLive: () => ({ data: null }) }));

import { canOpenInWindow, setItemWindowOpener } from "../kit/app/item-window";
import type { HostWindows } from "../kit/app/windows";
import {
  ITEM_WINDOW_IDS, itemWindowHref, itemWindowKey, itemWindowOptions, itemWindowTarget, itemWindowTargetOf, openItemWindow, pickItemWindow, registerItemWindows,
} from "./item-window";

const PAGE = "pg_0123456789abcdef";
const pageHref = `/plugins/studio/studio/pages/${PAGE}`;

function fakeWindows() {
  const log: string[] = [];
  const windows: HostWindows = {
    native: true,
    register: async () => true,
    open: async (id, options) => { log.push(`open ${id} ${new URLSearchParams(options?.params).toString()}`); return true; },
    toggle: async () => true,
    close: async (id) => { log.push(`close ${id}`); return true; },
  };
  return { windows, log };
}

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { setItemWindowOpener(null); });

it("names an item by kind and id, from its link or a window's params", () => {
  const target = itemWindowTarget(pageHref);
  expect(target).toEqual({ kind: "page", id: PAGE });
  expect(itemWindowKey(target!)).toBe(`page:${PAGE}`);
  // The address the old Pages add-on had names the same item.
  expect(itemWindowTarget(`/plugins/pages/pages/${PAGE}`)).toEqual(target);
  expect(itemWindowTarget("/plugins/studio/studio/bot")).toBeNull();
  expect(itemWindowTarget("/threads/thr_1")).toBeNull();
  expect(itemWindowOptions(target!, "Roadmap")).toMatchObject({ title: "Roadmap", params: { kind: "page", id: PAGE } });
  expect(itemWindowOptions(target!).transparent).toBeUndefined();
  expect(itemWindowTargetOf({ kind: "page", id: PAGE })).toEqual(target);
  expect(itemWindowTargetOf({ kind: "page", id: "nope" })).toBeNull();
  expect(itemWindowTargetOf({})).toBeNull();
  expect(itemWindowHref(target!)).toBe(pageHref);
});

it("gives each item one window: its own, else a free one, else the oldest", () => {
  expect(pickItemWindow({}, "page:a")).toEqual({ windowId: "item", replace: false });
  expect(pickItemWindow({ item: { key: "page:a", at: 1 } }, "page:a")).toEqual({ windowId: "item", replace: false });
  expect(pickItemWindow({ item: { key: "page:a", at: 1 } }, "page:b")).toEqual({ windowId: "item-2", replace: false });
  const full = Object.fromEntries(ITEM_WINDOW_IDS.map((id, index) => [id, { key: `page:${index}`, at: id === "item-3" ? 1 : 10 + index }]));
  expect(pickItemWindow(full, "page:new")).toEqual({ windowId: "item-3", replace: true });
});

it("opens an item's window once and brings it forward the next time", async () => {
  const { windows, log } = fakeWindows();
  const page = { kind: "page", id: PAGE };
  const other = { kind: "page", id: "pg_fedcba9876543210" };
  expect(await openItemWindow(windows, page, "Roadmap", 1)).toBe(true);
  expect(await openItemWindow(windows, other, undefined, 2)).toBe(true);
  expect(await openItemWindow(windows, page, "Roadmap", 3)).toBe(true);
  expect(log).toEqual([`open item kind=page&id=${PAGE}`, `open item-2 kind=page&id=${other.id}`, `open item kind=page&id=${PAGE}`]);
});

it("with every window taken, closes the oldest for the new item", async () => {
  const { windows, log } = fakeWindows();
  for (const [index] of ITEM_WINDOW_IDS.entries()) await openItemWindow(windows, { kind: "page", id: `pg_${String(index).padStart(16, "0")}` }, undefined, index + 1);
  log.length = 0;
  await openItemWindow(windows, { kind: "page", id: PAGE }, undefined, 100);
  expect(log).toEqual(["close item", `open item kind=page&id=${PAGE}`]);
});

it("offers Open in new window only on a BB with plugin windows, and only for items", () => {
  expect(canOpenInWindow(pageHref)).toBe(false);
  expect(registerItemWindows({ navPanel() {} }, {})).toBe(false);
  expect(canOpenInWindow(pageHref)).toBe(false);
  const ids: string[] = [];
  expect(registerItemWindows({ experimental_window: (registration: { id: string }) => { ids.push(registration.id); } }, {})).toBe(true);
  expect(ids).toEqual([...ITEM_WINDOW_IDS]);
  expect(canOpenInWindow(pageHref)).toBe(true);
  expect(canOpenInWindow("/plugins/studio/studio/bot")).toBe(false);
  expect(canOpenInWindow("/threads/thr_1")).toBe(false);
  expect(canOpenInWindow(null)).toBe(false);
});
