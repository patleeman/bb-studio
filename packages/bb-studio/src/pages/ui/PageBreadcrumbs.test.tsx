// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("../../kit/app/index", () => ({
  BarCrumb: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
  BarSeparator: () => <span />,
  openAppPath: state.open,
}));

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
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it("opens an ancestor through Studio's page path", () => {
  const parent = { id: "pg_parent", title: "Parent", icon: "📁", parentId: null } as PageMetaView;
  const page = { id: "pg_child", title: "Child", icon: "📄", parentId: parent.id } as PageMetaView;
  act(() => root.render(<PageBreadcrumbs page={page} pages={[parent, page]} />));

  act(() => host.querySelector("button")!.click());
  expect(state.open).toHaveBeenCalledWith(pagePath(parent.id));
});
