// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ItemGestures } from "./ItemGestures";

const state = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useBbNavigate: () => ({ toCompose: vi.fn() }), experimental_Icon: () => null }));
vi.mock("@bb-studio/kit/app", async importOriginal => ({
  ...(await importOriginal<typeof import("@bb-studio/kit/app")>()),
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
