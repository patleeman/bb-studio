// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ open: vi.fn(), set: vi.fn() }));
vi.mock("@get-bb/plugin-sdk/app", () => ({ useBbNavigate: () => ({ toCompose: vi.fn() }), experimental_Icon: () => null }));
vi.mock("../kit/app/host-sdk", async importOriginal => ({ ...(await importOriginal<typeof import("../kit/app/host-sdk")>()), hasGlobalWorkbench: true }));
vi.mock("../kit/app/index", async importOriginal => ({
  ...(await importOriginal<typeof import("../kit/app/index")>()),
  Icon: () => null,
  CopyReferenceMenuItem: () => null,
  OpenInWindowMenuItem: () => null,
  useOpenTarget: () => ({ open: state.open, anchor: null }),
  useItemStarred: () => ({ host: { set: state.set }, starred: false }),
}));

import { ItemGestures } from "./ItemGestures";

let root: Root, container: HTMLDivElement;
const settle = () => new Promise(resolve => setTimeout(resolve, 40));
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<ItemGestures />));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

it("in BB Studio (no splits) an item's menu has no Open in split, and says Star", async () => {
  const link = document.createElement("a");
  link.href = "/plugins/studio/studio/pages/pg_1"; link.textContent = "Plan";
  document.body.append(link);
  await act(async () => { link.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })); await settle(); });
  const items = [...document.querySelectorAll('[role="menuitem"]')].map(item => item.textContent?.trim());
  expect(items).toEqual(["Open", "Star", "New thread with this"]);
  const star = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent?.includes("Star"))!;
  await act(async () => { star.click(); await settle(); });
  expect(state.set).toHaveBeenCalledWith({ pluginId: "pages", id: "pg_1" }, true);
});
