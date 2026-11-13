// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useThreadUnreadDividerState } from "./useThreadUnreadDividerState";

interface DividerThread {
  id: string;
  lastReadAt: number | null;
  latestAttentionAt: number;
}

function render(thread: DividerThread, hasFreshThread = true) {
  return renderHook(
    (props: { thread: DividerThread; hasFreshThread: boolean }) =>
      useThreadUnreadDividerState({
        hasFreshThread: props.hasFreshThread,
        routeThreadId: props.thread.id,
        thread: props.thread,
      }),
    { initialProps: { thread, hasFreshThread } },
  );
}

afterEach(() => {
  cleanup();
});

describe("NEW stays out of the thread you are reading", () => {
  it("adds no divider when a reply lands in the open thread before it is marked read", () => {
    const view = render({ id: "thr_a", lastReadAt: 300, latestAttentionAt: 200 });
    view.rerender({
      thread: { id: "thr_a", lastReadAt: 300, latestAttentionAt: 400 },
      hasFreshThread: true,
    });
    expect(view.result.current).toEqual({
      ready: true,
      autoScroll: false,
      placement: null,
    });
  });

  it("still places the divider when an unread thread is opened", () => {
    const view = render({ id: "thr_a", lastReadAt: 100, latestAttentionAt: 200 });
    expect(view.result.current.placement).toEqual({ cutoffAt: 100 });
    view.rerender({
      thread: { id: "thr_b", lastReadAt: 250, latestAttentionAt: 300 },
      hasFreshThread: true,
    });
    expect(view.result.current).toEqual({
      ready: true,
      autoScroll: true,
      placement: { cutoffAt: 250 },
    });
  });
});
