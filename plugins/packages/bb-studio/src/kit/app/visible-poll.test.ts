// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { visiblePoll } from "./visible-poll";

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

describe("visiblePoll", () => {
  afterEach(() => {
    vi.useRealTimers();
    setVisibility("visible");
  });

  it("polls while visible, pauses while hidden, and refreshes on return to visibility", () => {
    vi.useFakeTimers();
    setVisibility("visible");
    const work = vi.fn();
    const stop = visiblePoll(work, 1000);

    vi.advanceTimersByTime(2500);
    expect(work).toHaveBeenCalledTimes(2);

    setVisibility("hidden");
    vi.advanceTimersByTime(5000);
    expect(work).toHaveBeenCalledTimes(2);

    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(work).toHaveBeenCalledTimes(3);

    stop();
    vi.advanceTimersByTime(5000);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(work).toHaveBeenCalledTimes(3);
  });
});
