// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SecondaryPanelTabStrip,
  secondaryPanelTabsToClose,
  type SecondaryPanelTabStripProps,
} from "./SecondaryPanelTabStrip";
import { WorkbenchPanelScope } from "./workbenchFork";

const commands = vi.hoisted(() => ({
  handlers: new Map<string, () => boolean>(),
}));

vi.mock("@/components/commands/AppCommandProvider", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/components/commands/AppCommandProvider")
    >();
  return {
    ...actual,
    useAppCommandShortcut: (command: string) =>
      command === "panel.closeAll"
        ? { label: "⌥⌘W", ariaKeyshortcuts: "Alt+Meta+W" }
        : null,
    useAppCommandHandler: (command: string, handler: () => boolean) => {
      commands.handlers.set(command, handler);
    },
  };
});

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  commands.handlers.clear();
  vi.unstubAllGlobals();
});

function makeTabs(
  pinnedIndexes: readonly number[] = [],
): SecondaryPanelTabStripProps["tabs"] {
  return Array.from({ length: 4 }, (_, index) => ({
    label: `file-${index}.ts`,
    isPinned: pinnedIndexes.includes(index),
    leadingVisual: null,
    statusLabel: null,
    onSelect: vi.fn(),
    onClose: vi.fn(),
    renderContent: () => null,
    tab: { id: `tab-${index}`, kind: "new-tab" as const },
  }));
}

function closeCounts(tabs: SecondaryPanelTabStripProps["tabs"]) {
  return tabs.map((tab) => vi.mocked(tab.onClose).mock.calls.length);
}

function renderStrip(
  tabs: SecondaryPanelTabStripProps["tabs"],
  options: { isPanelOpen?: boolean; paneFocused?: boolean } = {},
) {
  render(
    <WorkbenchPanelScope
      panelStateId={undefined}
      isFocused={options.paneFocused ?? true}
    >
      <SecondaryPanelTabStrip
        activeTabId="tab-1"
        tabs={tabs}
        onReorderTab={vi.fn()}
        usesDesktopChrome={false}
        isPanelOpen={options.isPanelOpen ?? true}
      />
    </WorkbenchPanelScope>,
  );
}

describe("Close all tabs", () => {
  it("closes every tab but the pinned ones, like Close other tabs", () => {
    const tabs = makeTabs([0]);
    expect(
      secondaryPanelTabsToClose(tabs, "tab-2", "all").map((tab) => tab.tab.id),
    ).toEqual(["tab-1", "tab-2", "tab-3"]);
    expect(secondaryPanelTabsToClose(tabs, "missing", "all")).toEqual([]);
  });

  it("sits right below Close tabs to the right, with its shortcut", () => {
    renderStrip(makeTabs());
    fireEvent.contextMenu(screen.getByRole("button", { name: "file-2.ts" }));
    const items = screen
      .getAllByRole("menuitem")
      .map((item) => item.textContent ?? "");
    const right = items.indexOf("Close tabs to the right");
    expect(right).toBeGreaterThan(-1);
    expect(items[right + 1]).toBe("Close all tabs⌥⌘W");
  });

  it("closes all closable tabs from the menu without selecting one", () => {
    const tabs = makeTabs([0]);
    renderStrip(tabs);
    fireEvent.contextMenu(screen.getByRole("button", { name: "file-2.ts" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Close all tabs/u }));
    expect(closeCounts(tabs)).toEqual([0, 1, 1, 1]);
    for (const tab of tabs) expect(tab.onSelect).not.toHaveBeenCalled();
  });

  it("is disabled when every tab is pinned", () => {
    renderStrip(makeTabs([0, 1, 2, 3]));
    fireEvent.contextMenu(screen.getByRole("button", { name: "file-2.ts" }));
    expect(
      screen
        .getByRole("menuitem", { name: /Close all tabs/u })
        .getAttribute("data-disabled"),
    ).not.toBeNull();
  });

  it("runs from the shortcut in the focused panel pane", () => {
    const tabs = makeTabs([3]);
    renderStrip(tabs);
    expect(commands.handlers.get("panel.closeAll")?.()).toBe(true);
    expect(closeCounts(tabs)).toEqual([1, 1, 1, 0]);
  });

  it("leaves an unfocused pane or a closed panel to someone else", () => {
    const unfocused = makeTabs();
    renderStrip(unfocused, { paneFocused: false });
    expect(commands.handlers.get("panel.closeAll")?.()).toBe(false);
    expect(closeCounts(unfocused)).toEqual([0, 0, 0, 0]);
    cleanup();
    const closed = makeTabs();
    renderStrip(closed, { isPanelOpen: false });
    expect(commands.handlers.get("panel.closeAll")?.()).toBe(false);
    expect(closeCounts(closed)).toEqual([0, 0, 0, 0]);
  });
});
