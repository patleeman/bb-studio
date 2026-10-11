// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSpaceGroups, type StudioSpace } from "./model.js";
import { thread } from "./test-thread.js";
import { RowProvider, ThreadTree, type RowContextValue } from "./ThreadRow.js";

vi.mock("@get-bb/plugin-sdk/app", () => ({
  ThreadTitle: ({ threadId }: { threadId: string }) => <span>{`Title ${threadId}`}</span>,
  useSidebarThreadShortcut: () => null,
  experimental_Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));
vi.mock("@bb-studio/kit/app", () => ({ useThreadBadge: () => null }));

afterEach(cleanup);

const home: StudioSpace = { id: "home", name: "Home", color: "red", icon: null, defaultProjectId: null, isDefault: true, projectIds: [] };
const launch: StudioSpace = { ...home, id: "launch", name: "Launch", isDefault: false };

function setup(overrides: Partial<RowContextValue> = {}) {
  const threads = [
    thread("lead", { updatedAt: Date.now() }),
    thread("worker", { parentThreadId: "lead", hasPendingInteraction: true }),
    thread("plain", { indicator: "unread-error" }),
  ];
  const [group] = buildSpaceGroups(threads, [launch, home], { lead: "launch", plain: "launch" }, { launch: "lead" });
  const actions = { open: vi.fn(), setPinned: vi.fn(async () => {}), setRead: vi.fn(async () => {}), rename: vi.fn(async () => {}), archive: vi.fn(), requestDelete: vi.fn() };
  const ctx: RowContextValue = {
    activeThreadId: null,
    lines: { lead: { text: "Drafting the plan", kind: "progress", at: null }, plain: { text: "Tests failed", kind: "failure", at: null } },
    marks: { lead: { kind: "lead", label: "Space lead" } },
    collapsed: new Set(),
    toggleCollapsed: vi.fn(),
    spaces: [home, launch],
    spaceIdOf: () => "launch",
    leads: { launch: "lead" },
    hidden: new Set(),
    setHidden: vi.fn(),
    moveThreads: vi.fn(async () => {}),
    setLead: vi.fn(),
    actions,
    onNavigate: vi.fn(),
    ...overrides,
  };
  render(
    <RowProvider value={ctx}>
      {[group!.lead!, ...group!.rest].map((node) => <ThreadTree key={node.thread.id} node={node} />)}
    </RowProvider>,
  );
  return { ctx, actions };
}

const row = (id: string) => document.querySelector<HTMLElement>(`[data-sidebar-thread-id="${id}"]`)!;

function openMenu(id: string) {
  fireEvent.contextMenu(row(id));
}

describe("ThreadRow", () => {
  it("draws two lines: a status mark, title and age or pill, then Studio's latest line", () => {
    setup();
    expect(row("lead").querySelector("[data-space-thread-mark]")?.getAttribute("data-space-thread-mark")).toBe("lead");
    expect(row("lead").textContent).toContain("Title lead");
    expect(row("lead").querySelector("[data-space-thread-time]")?.textContent).toBe("now");
    expect(row("lead").querySelector("[data-space-thread-line]")?.textContent).toBe("Drafting the plan");
    expect(row("plain").querySelector("[data-space-thread-line]")?.className).toContain("text-destructive");
    expect(row("plain").querySelector("[data-space-thread-pill]")?.textContent).toBe("Failed");
    expect(row("worker").querySelector("[data-space-thread-dot]")?.getAttribute("data-space-thread-dot")).toBe("needs-you");
  });

  it("nests sub-threads and folds them away", () => {
    const { ctx } = setup({ collapsed: new Set(["lead"]) });
    expect(row("worker")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show sub-threads" }));
    expect(ctx.toggleCollapsed).toHaveBeenCalledWith("lead");
  });

  it("opens a thread on click, in a split with ⌘", () => {
    const { actions, ctx } = setup();
    fireEvent.click(row("plain"));
    expect(actions.open).toHaveBeenCalledWith("plain", undefined);
    fireEvent.click(row("plain"), { metaKey: true });
    expect(actions.open).toHaveBeenLastCalledWith("plain", { split: true });
    expect(ctx.onNavigate).toHaveBeenCalled();
  });

  it("offers no Archive or Hide on a lead", () => {
    setup();
    openMenu("lead");
    const items = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(items).toContain("Promote");
    expect(items).not.toContain("Archive");
    expect(items).not.toContain("Hide");
  });

  it("archives and moves other threads from their menu", () => {
    const { actions } = setup();
    openMenu("plain");
    const items = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(items).toEqual(expect.arrayContaining(["Archive", "Hide", "Move to Space", "Pin", "Rename"]));
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    expect(actions.archive).toHaveBeenCalledWith("plain");
  });
});
