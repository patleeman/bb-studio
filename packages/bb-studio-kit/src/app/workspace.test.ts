// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { canOpenWorkspaceItem, openWorkspaceItem, registerWorkspaceOpener, registerWorkspaceProvider, publishWorkspaceAnchor, workspaceAnchors } from "./workspace";
import { openAppPath } from "./nav";
const disposers: (() => void)[] = [];
afterEach(() => { disposers.splice(0).reverse().forEach(dispose => dispose()); document.body.replaceChildren(); });
it("routes participating items into Studio and leaves add-ons standalone without Studio", () => {
  disposers.push(registerWorkspaceProvider("/plugins/pages/pages"));
  expect(openWorkspaceItem({ href: "/plugins/pages/pages/pg_one" })).toBe(false);
  const open = vi.fn();
  const dispose = registerWorkspaceOpener(open); disposers.push(dispose);
  openAppPath("/plugins/pages/pages/pg_one");
  expect(open).toHaveBeenCalledWith({ href: "/plugins/pages/pages/pg_one" }, "tab");
  expect(canOpenWorkspaceItem("/plugins/pages/pages")).toBe(false);
  expect(openWorkspaceItem({ href: "/threads/th_one" })).toBe(false);
  dispose();
  expect(openWorkspaceItem({ href: "/plugins/pages/pages/pg_one" })).toBe(false);
});
it("advertises destinations by owner and safely removes old generations", () => {
  const old = registerWorkspaceProvider("/plugins/pages/pages");
  disposers.push(registerWorkspaceProvider("/plugins/pages/pages"));
  old();
  expect(canOpenWorkspaceItem("/plugins/pages/pages/pg_one")).toBe(true);
  const element = document.createElement("div"); document.body.append(element);
  const anchor = { id: "test", path: "/plugins/pages/pages/pg_one", element };
  const dispose = publishWorkspaceAnchor(anchor); disposers.push(dispose);
  expect(workspaceAnchors("/plugins/pages/pages")).toEqual([anchor]);
  expect(workspaceAnchors("/plugins/talk/recordings")).toEqual([]);
  dispose(); expect(workspaceAnchors("/plugins/pages/pages")).toEqual([]);
});
