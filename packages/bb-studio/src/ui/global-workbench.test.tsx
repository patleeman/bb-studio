// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const openTab = vi.fn(() => true);
const visitTab = vi.fn(async () => ({ tab: { title: "Launch plan" } }));
const rpc = { call: visitTab };
vi.mock("@get-bb/plugin-sdk/app", () => ({ experimental_useAppPanel: () => ({ openTab }), useRpc: () => rpc }));

import { GlobalItemOpener as Opener, globalItemOf, requestGlobalItem, resetGlobalItemRequests } from "./global-workbench";
import { PageTabReceiver, resetPageTabRequests } from "./page-tab-requests";

/** The opener with the Studio page's receiver, which opens the tab in the page's own workbench. */
const GlobalItemOpener = () => <><PageTabReceiver /><Opener /></>;

const PAGE_ID = "pg_0123456789abcdef";
let root: Root;

beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); root = createRoot(document.createElement("div")); openTab.mockClear(); });
afterEach(() => { act(() => root.unmount()); resetGlobalItemRequests(); resetPageTabRequests(); vi.unstubAllGlobals(); });

it("opens a requested item as an ordinary tab of the Studio page, never a fixed one, whether asked before or after the page mounts", async () => {
  requestGlobalItem({ kind: "page", id: PAGE_ID, title: "Plan" });
  await act(async () => { root.render(<GlobalItemOpener />); });
  expect(openTab).toHaveBeenCalledTimes(1);
  expect(openTab).toHaveBeenLastCalledWith({
    tab: { id: "studio", context: { kind: "nav-panel", panelId: "studio" }, availability: "action" },
    params: { kind: "page", id: PAGE_ID }, title: "Plan",
  });
  await act(async () => { requestGlobalItem({ kind: "page", id: PAGE_ID }); });
  expect(openTab).toHaveBeenCalledTimes(2);
});

it("reads an item only from params that name a known kind and a valid id", () => {
  expect(globalItemOf({ kind: "page", id: PAGE_ID })).toEqual({ kind: "page", id: PAGE_ID });
  expect(globalItemOf({ kind: "page", id: "../etc" })).toBeNull();
  expect(globalItemOf({ kind: "nope", id: PAGE_ID })).toBeNull();
  expect(globalItemOf(null)).toBeNull();
  expect(globalItemOf(["page", PAGE_ID])).toBeNull();
});

it("names the tab for the item when the request carries only its address", async () => {
  requestGlobalItem({ kind: "page", id: PAGE_ID, href: `/plugins/studio/studio/pages/${PAGE_ID}` });
  await act(async () => { root.render(<GlobalItemOpener />); });
  expect(visitTab).toHaveBeenCalledWith("visitTab", { path: `/plugins/studio/studio/pages/${PAGE_ID}` });
  expect(openTab).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Launch plan" }));
  expect(openTab).not.toHaveBeenLastCalledWith(expect.objectContaining({ experimental_global: true }));
});
