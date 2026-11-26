// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Provider as JotaiProvider, createStore } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExperimentalThreadContextCardProps } from "@get-bb/plugin-sdk";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import {
  ThreadContextCard,
  ThreadContextCardHeaderButton,
  ThreadContextCardProvider,
} from "@/components/plugin/PluginThreadContextCard";
import { SurfaceInfoSection } from "@/components/plugin/ThreadContextCardSection";
import {
  removePluginSlotRegistrations,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  CORE_THREAD_CONTEXT_CARD_ROWS,
  CORE_THREAD_CONTEXT_CARD_SECTIONS,
} from "./ThreadContextCardCore";
import { studioCoreCardEntries } from "./threadContextCardCore.fork";

function PluginSection({ threadId }: ExperimentalThreadContextCardProps) {
  return (
    <SurfaceInfoSection label="Deploys">
      <p>Deploys for {threadId}</p>
    </SurfaceInfoSection>
  );
}

const PARENT_ROWS_WITHOUT_PARENT = CORE_THREAD_CONTEXT_CARD_ROWS.map((row) => ({
  ...row,
  component: () => null,
}));

function renderPane(paneWidth: number) {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(
    paneWidth,
  );
  render(
    <JotaiProvider store={createStore()}>
      <TooltipProvider>
        <MemoryRouter>
          <ThreadContextCardProvider
            enabled
            coreRows={PARENT_ROWS_WITHOUT_PARENT}
            coreSections={CORE_THREAD_CONTEXT_CARD_SECTIONS}
            threadId="thr_1"
            projectId="proj_1"
            environment={null}
          >
            <header>
              <ThreadContextCardHeaderButton />
            </header>
            <div data-scroll-overlay="">
              <ThreadContextCard />
            </div>
          </ThreadContextCardProvider>
        </MemoryRouter>
      </TooltipProvider>
    </JotaiProvider>,
  );
}

afterEach(() => {
  cleanup();
  removePluginSlotRegistrations("first");
  vi.restoreAllMocks();
});

describe("Studio's thread context card entries", () => {
  it("drop core's Child threads section and keep the parent row", () => {
    expect(CORE_THREAD_CONTEXT_CARD_SECTIONS).toEqual([]);
    expect(CORE_THREAD_CONTEXT_CARD_ROWS.map((row) => row.id)).toEqual([
      "parent",
    ]);
    expect(
      studioCoreCardEntries([{ id: "childThreads" }, { id: "other" }]),
    ).toEqual([{ id: "other" }]);
  });

  it("draw no pinned card in card layout when nothing has content", () => {
    renderPane(1600);
    expect(screen.queryByRole("group", { name: "Thread context" })).toBeNull();
    expect(screen.queryByText("Child threads")).toBeNull();
  });

  it("list no child threads in the banner layout's popover", () => {
    renderPane(900);
    fireEvent.click(screen.getByRole("button", { name: "Thread context" }));
    const card = screen.getByRole("group", { name: "Thread context" });
    expect(card.textContent).not.toContain("Child threads");
    expect(card.textContent).toContain("Nothing to show yet");
  });

  it("still show a plugin's section", () => {
    setPluginSlotRegistrations(
      "first",
      makePluginRegistrationSet({
        threadContextCardSections: [
          {
            id: "deploys",
            group: "2_deploys",
            component: PluginSection,
            legacyTitle: null,
          },
        ],
      }),
    );
    renderPane(1600);
    expect(
      screen.getByRole("button", { name: "Unpin thread context" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("group", { name: "Thread context" }).textContent,
    ).toContain("Deploys for thr_1");
    expect(screen.queryByText("Child threads")).toBeNull();
  });
});
