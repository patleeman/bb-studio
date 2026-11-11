// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ExperimentalThreadHeaderRegistration,
  PluginThreadActionTarget,
} from "@get-bb/plugin-sdk";
import { useRenameController } from "@bb/shared-ui/inline-rename";
import { RenameControllerProvider } from "@/components/sidebar/SidebarInlineRename";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  PaneContext,
  type PaneContextValue,
} from "@/views/thread-detail/PaneContext";
import { ThreadDetailHeader } from "@/views/thread-detail/ThreadDetailHeader";

const mocks = vi.hoisted(() => ({ renameThreadAsync: vi.fn() }));

vi.mock("@/components/thread/ThreadActionsProvider", () => ({
  useThreadActions: () => ({ renameThreadAsync: mocks.renameThreadAsync }),
}));

vi.mock("@/components/layout/AppPageHeader", () => ({
  HEADER_ICON_BUTTON_CLASS: "header-icon-button",
  HEADER_PANE_ACTION_ICON_BUTTON_CLASS: "header-pane-action-button",
  AppPageHeader: ({
    actions,
    center,
  }: {
    actions?: ReactNode;
    center?: ReactNode;
  }) => (
    <header>
      <div data-testid="center">{center}</div>
      {actions}
    </header>
  ),
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({ data: { keybindings: [] } }),
}));

const PANE_CONTEXT: PaneContextValue = {
  paneId: "main",
  isFocused: true,
  isSplitPane: false,
  secondaryPanelHost: null,
  reservesWindowPanelToggle: false,
  onRequestClose: null,
  isMaximized: false,
  onToggleMaximize: null,
  isBoundedPane: false,
  isTopRow: true,
  ownsWindowTopLeft: true,
  navigateInPane: vi.fn(),
};

function target(id: string): PluginThreadActionTarget {
  return {
    id,
    projectId: "proj_header",
    parentThreadId: null,
    parentNotifications: "auto",
    archivedAt: null,
    pinnedAt: null,
    sectionId: null,
    isUnread: false,
    status: "idle",
    environment: null,
  };
}

function Host({ children }: { children: ReactNode }) {
  const controller = useRenameController();
  return (
    <RenameControllerProvider controller={controller}>
      <PaneContext.Provider value={PANE_CONTEXT}>
        {children}
      </PaneContext.Provider>
    </RenameControllerProvider>
  );
}

function header(threadId: string, threadTitle: string) {
  return (
    <ThreadDetailHeader
      actionsMenu={null}
      isSecondaryPanelOpen={false}
      onToggleSecondaryPanel={vi.fn()}
      thread={target(threadId)}
      threadTitle={threadTitle}
    />
  );
}

function register(
  pluginId: string,
  threadHeaders: ExperimentalThreadHeaderRegistration[],
) {
  setPluginSlotRegistrations(
    pluginId,
    makePluginRegistrationSet({ threadHeaders }),
  );
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
  mocks.renameThreadAsync.mockReset();
});

describe("thread header decorations", () => {
  it("shows the plugin's title and node after it in the title row, per thread", () => {
    register("studio", [
      {
        id: "chat",
        useDecoration: ({ threadId }) =>
          threadId === "thr_plain"
            ? null
            : { title: `Main · with ${threadId}`, after: <b>Running</b> },
      },
    ]);
    const { rerender } = render(header("thr_bot", "Real title"), {
      wrapper: Host,
    });
    expect(screen.getByText("Main · with thr_bot")).toBeTruthy();
    expect(screen.queryByText("Real title")).toBeNull();
    const after = screen.getByText("Running");
    const title = screen.getByText("Main · with thr_bot");
    expect(after.closest("p")).toBeNull();
    expect(screen.getByTestId("center").contains(after)).toBe(true);
    expect(
      title.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    rerender(header("thr_plain", "Plain title"));
    expect(screen.getByText("Plain title")).toBeTruthy();
    expect(screen.queryByText("Running")).toBeNull();
  });

  it("edits and saves the real title, not the decorated one", async () => {
    mocks.renameThreadAsync.mockResolvedValue(undefined);
    register("studio", [
      { id: "chat", useDecoration: () => ({ title: "Main · with Bot" }) },
    ]);
    render(header("thr_bot", "Real title"), { wrapper: Host });

    fireEvent.doubleClick(screen.getByText("Main · with Bot"));
    const input = await screen.findByRole("textbox", { name: "Thread name" });
    expect(input).toHaveProperty("value", "Real title");
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(mocks.renameThreadAsync).toHaveBeenCalledWith(
        "thr_bot",
        "Renamed",
      ),
    );
  });

  it("uses the first plugin by id that returns a decoration, and follows hook state", () => {
    let setLabel: (label: string | null) => void = () => {};
    register("zeta", [
      { id: "z", useDecoration: () => ({ title: "From zeta" }) },
    ]);
    register("alpha", [
      {
        id: "a",
        useDecoration: () => {
          const [label, set] = useState<string | null>(null);
          setLabel = set;
          return label === null ? null : { title: label };
        },
      },
    ]);
    render(header("thr_a", "Real title"), { wrapper: Host });
    expect(screen.getByText("From zeta")).toBeTruthy();

    act(() => setLabel("From alpha"));
    expect(screen.getByText("From alpha")).toBeTruthy();
    act(() => setLabel(null));
    expect(screen.getByText("From zeta")).toBeTruthy();
  });

  it("drops a decoration whose hook throws and keeps bb's title", () => {
    register("studio", [
      {
        id: "broken",
        useDecoration: () => {
          throw new Error("boom");
        },
      },
    ]);
    const errors = console.error;
    const warnings = console.warn;
    console.error = () => {};
    console.warn = () => {};
    try {
      render(header("thr_a", "Real title"), { wrapper: Host });
    } finally {
      console.error = errors;
      console.warn = warnings;
    }
    expect(screen.getByText("Real title")).toBeTruthy();
  });
});
