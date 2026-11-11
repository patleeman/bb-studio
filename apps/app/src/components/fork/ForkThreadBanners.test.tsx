// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { forkThreadBanner } from "./ForkThreadBanners";

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
});

function Screen({ threadId }: { threadId: string }) {
  return (
    <>
      {forkThreadBanner(threadId)}
      <p>Transcript</p>
    </>
  );
}

describe("thread banners", () => {
  it("draws each plugin's banner above the transcript with the thread it is in, and nothing without one", () => {
    const { rerender } = render(<Screen threadId="thr_a" />);
    expect(document.querySelector("[data-fork-thread-banner]")).toBeNull();
    setPluginSlotRegistrations(
      "studio",
      makePluginRegistrationSet({
        threadBanners: [
          {
            id: "status",
            component: ({ threadId }) =>
              threadId === "thr_b" ? null : <span>Status of {threadId}</span>,
          },
        ],
      }),
    );
    rerender(<Screen threadId="thr_a" />);
    const banner = screen.getByText("Status of thr_a");
    const transcript = screen.getByText("Transcript");
    expect(
      banner.compareDocumentPosition(transcript) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    rerender(<Screen threadId="thr_b" />);
    expect(screen.queryByText(/Status of/)).toBeNull();
    expect(screen.getByText("Transcript")).toBeTruthy();
  });

  it("hides a banner that throws and keeps the transcript", () => {
    setPluginSlotRegistrations(
      "studio",
      makePluginRegistrationSet({
        threadBanners: [
          {
            id: "broken",
            component: () => {
              throw new Error("boom");
            },
          },
        ],
      }),
    );
    const errors = console.error;
    console.error = () => {};
    try {
      render(<Screen threadId="thr_a" />);
    } finally {
      console.error = errors;
    }
    expect(screen.getByText("Transcript")).toBeTruthy();
  });
});
