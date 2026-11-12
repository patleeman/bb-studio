// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ open: vi.fn(), inTabRow: false }));
vi.mock("../../kit/app/index", () => ({
  BarCrumb: ({ children, onClick }: { children?: React.ReactNode; onClick?: (event: React.MouseEvent) => void }) => <button onClick={onClick}>{children}</button>,
  BarSeparator: () => <span />,
  cn: (...names: unknown[]) => names.filter(Boolean).join(" "),
  useInTabRow: () => state.inTabRow,
  wantsAlternate: (event?: { metaKey?: boolean; ctrlKey?: boolean }) => Boolean(event?.metaKey || event?.ctrlKey),
}));
vi.mock("../../ui/studio-open", () => ({ useStudioOpen: () => state.open }));

import { PageBreadcrumbs } from "./PageBreadcrumbs";
import { pagePath } from "../constants";
import type { PageMetaView } from "../contract";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  state.open.mockReset();
  state.inTabRow = false;
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it("opens an ancestor by Studio's rule, Mod-click in the other place", () => {
  const parent = { id: "pg_parent", title: "Parent", icon: "📁", parentId: null } as PageMetaView;
  const page = { id: "pg_child", title: "Child", icon: "📄", parentId: parent.id } as PageMetaView;
  act(() => root.render(<PageBreadcrumbs page={page} pages={[parent, page]} />));

  act(() => host.querySelector("button")!.click());
  expect(state.open).toHaveBeenCalledWith({ href: pagePath(parent.id), title: "Parent" }, { alternate: false });
  // Mod-click: the other place.
  act(() => host.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true })));
  expect(state.open).toHaveBeenLastCalledWith({ href: pagePath(parent.id), title: "Parent" }, { alternate: true });
});

it("shows only the parents beside workspace tabs, folding the middle ones", () => {
  state.inTabRow = true;
  const pages = ["Launch", "Plans", "Q4", "Risks"].map((title, index) => ({ id: `pg_${index}`, title, icon: "", parentId: index ? `pg_${index - 1}` : null }) as PageMetaView);
  const page = { id: "pg_child", title: "Child", icon: "", parentId: "pg_3" } as PageMetaView;
  act(() => root.render(<PageBreadcrumbs page={page} pages={[...pages, page]} />));

  const parents = host.querySelector("[data-page-parents]")!;
  expect(parents.getAttribute("title")).toBe("Launch / Plans / Q4 / Risks / Child");
  expect([...parents.querySelectorAll("button")].map((each) => each.textContent)).toEqual(["Launch", "Risks"]);
  expect(parents.textContent).toContain("…");
  expect(parents.textContent).not.toContain("Child");
  act(() => parents.querySelectorAll("button")[1]!.click());
  expect(state.open).toHaveBeenCalledWith({ href: pagePath("pg_3"), title: "Risks" }, { alternate: false });
});

it("shows nothing beside workspace tabs for a top-level page", () => {
  state.inTabRow = true;
  const page = { id: "pg_top", title: "Top", icon: "", parentId: null } as PageMetaView;
  act(() => root.render(<PageBreadcrumbs page={page} pages={[page]} />));
  expect(host.textContent).toBe("");
});
