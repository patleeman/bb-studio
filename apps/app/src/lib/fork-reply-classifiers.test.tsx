// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { useQuietReply } from "./fork-reply-classifiers";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "./plugin-slots";

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
});

function Reply({ text }: { text: string }) {
  return <p>{useQuietReply(text) ? "quiet" : text}</p>;
}

describe("useQuietReply", () => {
  it("redraws a reply that was on screen before its classifier registered", () => {
    render(<Reply text="[PASS]" />);
    expect(screen.getByText("[PASS]")).toBeTruthy();
    act(() => {
      setPluginSlotRegistrations(
        "studio",
        makePluginRegistrationSet({
          replyClassifiers: [
            { id: "pass", classify: (text) => ({ quiet: text === "[PASS]" }) },
          ],
        }),
      );
    });
    expect(screen.getByText("quiet")).toBeTruthy();
  });

  it("leaves other replies as they are and survives a classifier that throws", () => {
    setPluginSlotRegistrations(
      "studio",
      makePluginRegistrationSet({
        replyClassifiers: [
          {
            id: "broken",
            classify: () => {
              throw new Error("no");
            },
          },
        ],
      }),
    );
    render(<Reply text="Done." />);
    expect(screen.getByText("Done.")).toBeTruthy();
  });
});
