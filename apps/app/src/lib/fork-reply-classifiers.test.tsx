// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import { classifyPluginMessage, useQuietReply } from "./fork-reply-classifiers";
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

describe("classifyPluginMessage", () => {
  it("returns the first classifier's answer with a trimmed sender and a clamped preview start", () => {
    setPluginSlotRegistrations(
      "studio",
      makePluginRegistrationSet({
        replyClassifiers: [
          { id: "plain", classify: () => null },
          {
            id: "broken",
            classify: () => null,
            classifyMessage: () => {
              throw new Error("no");
            },
          },
          {
            id: "relay",
            classify: () => null,
            classifyMessage: (text, context) =>
              text.startsWith("Watcher ") && context.part === "message"
                ? { sender: "  watcher Inbox ", previewStart: 999 }
                : null,
          },
        ],
      }),
    );
    expect(
      classifyPluginMessage("Watcher Inbox: 3 new", {
        part: "message",
        initiator: "user",
      }),
    ).toEqual({ sender: "watcher Inbox", previewStart: 20 });
    expect(
      classifyPluginMessage("Watcher Inbox: 3 new", {
        part: "body",
        initiator: null,
      }),
    ).toBeNull();
    expect(
      classifyPluginMessage("Status?", { part: "message", initiator: "user" }),
    ).toBeNull();
  });

  it("is null when no plugin classifies messages", () => {
    expect(
      classifyPluginMessage("Watcher Inbox: 3 new", {
        part: "message",
        initiator: "user",
      }),
    ).toBeNull();
  });
});
