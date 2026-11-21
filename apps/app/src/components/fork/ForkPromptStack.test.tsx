// @vitest-environment jsdom

import { cleanup, render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import {
  ThreadChildThreadsBanner,
  type ThreadPromptChildThreadsSection,
} from "@/components/promptbox/banner/ThreadPromptContextBanner";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { useForkChildThreads, useForkPromptStackHidden } from "./ForkPromptStack";

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
});

function hideActiveChildThreads() {
  setPluginSlotRegistrations(
    "studio",
    makePluginRegistrationSet({
      hiddenHostEntries: [{ id: "prompt-stack", promptStack: ["active-child-threads"] }],
    }),
  );
}

const running = { id: "thr_run", title: "Build: strands", href: "/threads/thr_run", hasPendingInteraction: false };
const waiting = { id: "thr_ask", title: "Router fix", href: "/threads/thr_ask", hasPendingInteraction: true };
const section = (items: ThreadPromptChildThreadsSection["items"]): ThreadPromptChildThreadsSection => ({ items, pendingInteractions: [] });

describe("the prompt stack a plugin hides", () => {
  it("keeps every child until a plugin hides the running ones; then only children waiting on the user stay", () => {
    const all = section([running, waiting]);
    const { result, rerender } = renderHook(() => ({ hidden: useForkPromptStackHidden("active-child-threads"), shown: useForkChildThreads(all) }));
    expect(result.current.hidden).toBe(false);
    expect(result.current.shown).toBe(all);
    hideActiveChildThreads();
    rerender();
    expect(result.current.hidden).toBe(true);
    expect(result.current.shown?.items).toEqual([waiting]);
    expect(useForkChildThreadsOf(null)).toBeNull();
  });

  it("draws no Active child threads card while only running children are left", () => {
    const view = (items: ThreadPromptChildThreadsSection["items"]) =>
      render(
        <MemoryRouter>
          <ThreadChildThreadsBanner childThreads={section(items)} isExpanded onExpandedChange={() => {}} />
        </MemoryRouter>,
      );
    view([running]);
    expect(screen.queryByText("Build: strands")).not.toBeNull();
    cleanup();
    hideActiveChildThreads();
    const { container } = view([running]);
    expect(container.innerHTML).toBe("");
  });
});

function useForkChildThreadsOf(value: null) {
  return renderHook(() => useForkChildThreads(value)).result.current;
}
