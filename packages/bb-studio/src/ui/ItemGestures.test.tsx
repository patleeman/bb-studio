// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ItemGestures } from "./ItemGestures";

const state = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useBbNavigate: () => ({ toCompose: vi.fn() }), experimental_Icon: () => null }));
vi.mock("../kit/app/index", async importOriginal => ({
  ...(await importOriginal<typeof import("../kit/app/index")>()),
  Icon: () => null,
  CopyReferenceMenuItem: () => null,
  useOpenTarget: () => ({ open: state.open, anchor: null }),
}));

let root: Root, container: HTMLDivElement;
const settle = () => new Promise(resolve => setTimeout(resolve, 40));
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.open.mockReset();
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<ItemGestures />));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

it("offers Open and Open in split, and no Float, for a right-clicked item link", async () => {
  const link = document.createElement("a");
  link.href = "/plugins/pages/pages/pg_1"; link.textContent = "Plan";
  document.body.append(link);
  await act(async () => { link.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })); await settle(); });
  const items = [...document.querySelectorAll('[role="menuitem"]')].map(item => item.textContent?.trim());
  expect(items).toEqual(expect.arrayContaining(["Open", expect.stringContaining("Open in split"), "New thread with this"]));
  expect(items.some(item => item?.includes("Float"))).toBe(false);
  const split = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent?.includes("Open in split"))!;
  await act(async () => { split.click(); await settle(); });
  expect(state.open).toHaveBeenCalledWith({ kind: "path", path: "/plugins/pages/pages/pg_1", title: "Plan" }, "split");
});

it("a dragged link to a thread or a Studio item carries the item; any other link is left alone", async () => {
  const { fakeTransfer, dispatchDrag } = await import("../kit/app/drag-testing");
  const { readDragItem, clearDragItem, ITEM_DRAG_TYPE } = await import("../kit/app/item-drag");
  const link = (href: string, text: string) => { const a = document.createElement("a"); a.href = href; a.textContent = text; document.body.append(a); return a; };
  const thread = fakeTransfer();
  dispatchDrag("dragstart", link("/threads/thr_1", "Fix login"), thread);
  expect(readDragItem(thread)).toEqual({ kind: "thread", id: "thr_1", title: "Fix login", path: "/threads/thr_1" });
  const page = fakeTransfer();
  dispatchDrag("dragstart", link("/plugins/studio/studio/pages/pg_0123456789abcdef", "Plan"), page);
  expect(readDragItem(page)).toMatchObject({ kind: "doc", id: "pg_0123456789abcdef", title: "Plan", pluginId: "studio" });
  const other = fakeTransfer();
  dispatchDrag("dragstart", link("https://example.com/", "Elsewhere"), other);
  expect(other.types).not.toContain(ITEM_DRAG_TYPE);
  // A source that wrote its own item keeps it.
  const own = fakeTransfer();
  own.setData(ITEM_DRAG_TYPE, JSON.stringify({ kind: "thread", id: "mine", title: "Mine" }));
  dispatchDrag("dragstart", link("/threads/thr_2", "Other"), own);
  expect(readDragItem(own)?.id).toBe("mine");
  clearDragItem();
});

it("holds back the right-clicked row's tooltip while its menu is open, and gives it back on the next press", async () => {
  const { holdTooltips } = await import("./ItemGestures");
  const row = document.createElement("button");
  row.title = "Fork redesign";
  const label = document.createElement("span");
  label.title = "Forked from Main";
  row.append(label);
  document.body.append(row);
  expect(holdTooltips(label)).toBe(2);
  expect(row.hasAttribute("title")).toBe(false);
  expect(label.hasAttribute("title")).toBe(false);
  await settle();
  document.dispatchEvent(new Event("pointerdown"));
  expect(row.title).toBe("Fork redesign");
  expect(label.title).toBe("Forked from Main");
  // A right-click anywhere takes the tooltip off, also over BB's own row menus.
  await act(async () => { label.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); });
  expect(row.hasAttribute("title")).toBe(false);
});

it("a Mod- or Shift-click on a link the registry knows goes to the link router with the keys held; other links and plain clicks don't", async () => {
  const { linkGesture } = await import("./ItemGestures");
  const page = { kind: "path" as const, path: "/plugins/studio/studio/pages/pg_0123456789abcdef", title: "Plan" };
  expect(linkGesture({ metaKey: true, ctrlKey: false, shiftKey: false }, page)).toEqual({ link: page.path, modifiers: { meta: true, ctrl: false, shift: false }, title: "Plan" });
  expect(linkGesture({ metaKey: false, ctrlKey: false, shiftKey: true }, { kind: "thread", threadId: "thr_1" })).toEqual({ link: "/threads/thr_1", modifiers: { meta: false, ctrl: false, shift: true }, title: null });
  expect(linkGesture({ metaKey: false, ctrlKey: false, shiftKey: false }, page)).toBeNull();
  expect(linkGesture({ metaKey: true, ctrlKey: false, shiftKey: false }, { kind: "path", path: "/plugins/other/panel/x" })).toBeNull();
});
