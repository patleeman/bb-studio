// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { TooltipProvider } from "@/components/ui/tooltip";
import { showsItem, SpaceStudioList } from "./SpaceStudioList.js";
import type { SpaceItems } from "./studioSpaces.js";

vi.mock("@get-bb/plugin-sdk/app", async (actual) => ({
  ...(await actual<object>()),
  useSdk: () => ({ plugins: { callRpc: () => Promise.resolve({ ok: true }) } }),
}));

installTestPluginRuntime();
afterEach(cleanup);

const mockup = { pluginId: "artifacts", id: "art_1", title: "Mockup", icon: null, kindIcon: "File", href: "/plugins/artifacts/artifacts/art_1", pinned: false, kindLabel: "Artifact", updatedAt: 0, preview: null };
const withOpen = (open: SpaceItems["open"]): SpaceItems => ({ open, all: [], count: 1 });
const list = (items: SpaceItems) => (
  <TooltipProvider>
    <SpaceStudioList spaceName="Work" items={items} />
  </TooltipProvider>
);

describe("SpaceStudioList", () => {
  it("shows an item opened again after it was closed", () => {
    const { rerender } = render(list(withOpen([mockup])));
    fireEvent.click(screen.getByRole("button", { name: "Close Mockup" }));
    expect(screen.queryByText("Mockup")).toBeNull();
    // Studio's next list has it closed; then it is opened again.
    rerender(list(withOpen([])));
    rerender(list(withOpen([mockup])));
    expect(screen.getByText("Mockup")).toBeTruthy();
  });

  it("keeps a closed item hidden while a stale list still has it", () => {
    const { rerender } = render(list(withOpen([mockup])));
    fireEvent.click(screen.getByRole("button", { name: "Close Mockup" }));
    rerender(list(withOpen([{ ...mockup }])));
    expect(screen.queryByText("Mockup")).toBeNull();
  });
});

describe("showsItem", () => {
  it("matches the item's own route and views under it, not a sibling that shares a prefix", () => {
    expect(showsItem("/plugins/pages/pages/pg_1", "/plugins/pages/pages/pg_1")).toBe(true);
    expect(showsItem("/plugins/pages/pages/pg_1/compose", "/plugins/pages/pages/pg_1?x=1")).toBe(true);
    expect(showsItem("/plugins/pages/pages/pg_10", "/plugins/pages/pages/pg_1")).toBe(false);
    expect(showsItem("/threads/thr_1", "/plugins/pages/pages/pg_1")).toBe(false);
  });
});
