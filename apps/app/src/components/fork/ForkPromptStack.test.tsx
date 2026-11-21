// @vitest-environment jsdom


import { cleanup, render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { ExperimentalHostPromptStackEntry } from "@get-bb/plugin-sdk/app";
import {
  ThreadChildThreadsBanner,
  ThreadPromptContextBanner,
  type ThreadPromptChildThreadsSection,
} from "@/components/promptbox/banner/ThreadPromptContextBanner";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  ForkThreadContextElsewhere,
  useForkChildThreads,
  useForkPromptStackHidden,
} from "./ForkPromptStack";

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
});

const STRANDS_THREAD = "thr_strands";
const PLAIN_THREAD = "thr_plain";

function hideIn(threadId: string, entries: readonly ExperimentalHostPromptStackEntry[]) {
  const listeners = new Set<() => void>();
  let current = entries;
  setPluginSlotRegistrations(
    "studio",
    makePluginRegistrationSet({
      hiddenHostEntries: [{
        id: "prompt-stack",
        promptStackFor: {
          get: (id: string) => (id === threadId ? current : []),
          subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        },
      }],
    }),
  );
  return { set(next: readonly ExperimentalHostPromptStackEntry[]) { current = next; for (const listener of listeners) listener(); } };
}

const running = { id: "thr_run", title: "Build: strands", href: "/threads/thr_run", hasPendingInteraction: false };
const waiting = { id: "thr_ask", title: "Router fix", href: "/threads/thr_ask", hasPendingInteraction: true };
const section = (items: ThreadPromptChildThreadsSection["items"]): ThreadPromptChildThreadsSection => ({ items, pendingInteractions: [] });

describe("the running children a plugin hides, thread by thread", () => {
  it("keeps every child in a plain thread, hides the running ones in a strands thread, and always keeps a child waiting on the user", () => {
    const all = section([running, waiting]);
    const source = hideIn(STRANDS_THREAD, ["active-child-threads"]);
    const plain = renderHook(() => useForkChildThreads(all, PLAIN_THREAD));
    expect(plain.result.current).toBe(all);
    const strands = renderHook(() => ({ hidden: useForkPromptStackHidden("active-child-threads", STRANDS_THREAD), shown: useForkChildThreads(all, STRANDS_THREAD) }));
    expect(strands.result.current.hidden).toBe(true);
    expect(strands.result.current.shown?.items).toEqual([waiting]);
    source.set([]);
    strands.rerender();
    expect(strands.result.current.shown).toBe(all);
  });

  it("draws no Active child threads card in a strands thread while only running children are left; a plain thread keeps it", () => {
    hideIn(STRANDS_THREAD, ["active-child-threads"]);
    function Card({ threadId }: { threadId: string }) {
      const shown = useForkChildThreads(section([running]), threadId);
      return <ThreadChildThreadsBanner childThreads={shown} isExpanded onExpandedChange={() => {}} />;
    }
    const plain = render(<MemoryRouter><Card threadId={PLAIN_THREAD} /></MemoryRouter>);
    expect(screen.queryByText("Build: strands")).not.toBeNull();
    plain.unmount();
    const strands = render(<MemoryRouter><Card threadId={STRANDS_THREAD} /></MemoryRouter>);
    expect(strands.container.innerHTML).toBe("");
  });
});

describe("the thread context row a plugin moves away from the composer", () => {
  const parentThread = { parentThreadTitle: "Main", href: "/threads/thr_main", relationship: "parent" as const };
  const row = (threadId: string, over: { archived?: boolean } = {}) => (
    <MemoryRouter>
      <ThreadPromptContextBanner
        input={{ threadId, projectId: "proj_1", environment: null }}
        core={{ parentThread }}
        archivedSection={over.archived ? { archivedAt: 1 } : null}
        environmentGoneSection={null}
        expandedSegment={null}
        onToggleSegment={() => {}}
      />
    </MemoryRouter>
  );
  const contextRow = () => screen.queryByRole("region", { name: "Thread context before sending" });

  it("keeps it above a plain thread's composer, hides it above a strands thread's, and keeps the archived row", () => {
    hideIn(STRANDS_THREAD, ["thread-context"]);
    const plain = render(row(PLAIN_THREAD));
    expect(contextRow()).not.toBeNull();
    plain.unmount();
    const strands = render(row(STRANDS_THREAD));
    expect(strands.container.innerHTML).toBe("");
    strands.unmount();
    render(row(STRANDS_THREAD, { archived: true }));
    expect(screen.getByText("Thread is archived")).toBeTruthy();
  });

  it("draws the same row where a plugin puts it (experimental_ThreadContextSegments), even where it is hidden above the composer", () => {
    hideIn(STRANDS_THREAD, ["thread-context"]);
    render(<ForkThreadContextElsewhere.Provider value>{row(STRANDS_THREAD)}</ForkThreadContextElsewhere.Provider>);
    expect(contextRow()).not.toBeNull();
  });
});
