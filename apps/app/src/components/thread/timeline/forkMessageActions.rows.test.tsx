// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { ExperimentalMessageActionMessage } from "@get-bb/plugin-sdk";
import { conversationRow } from "@/test/fixtures/thread-timeline-rows";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { ThreadTimelineRows } from "./ThreadTimelineRows";

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
});

function menuItemsOf(rowId: string): (string | null)[] {
  const row = document.querySelector<HTMLElement>(
    `[data-timeline-row-id="${rowId}"]`,
  );
  if (row === null) throw new Error(`no row ${rowId}`);
  fireEvent.pointerDown(
    within(row).getByRole("button", { name: "Message actions" }),
  );
  const items = within(screen.getByRole("menu"))
    .queryAllByRole("menuitem")
    .map((item) => item.textContent);
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  return items;
}

describe("plugin items in the message ··· menu of the thread view", () => {
  it("shows a plugin's item where isAvailable allows and runs it with the message", () => {
    const ran: ExperimentalMessageActionMessage[] = [];
    setPluginSlotRegistrations(
      "studio",
      makePluginRegistrationSet({
        forkMessageActions: [
          {
            id: "fork-here",
            title: "Fork conversation from here",
            isAvailable: (message) => message.role === "assistant",
            run: (message) => {
              ran.push(message);
            },
          },
        ],
      }),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ThreadTimelineRows
            threadId="thr_main"
            timelineRows={[
              conversationRow({
                id: "user_row",
                role: "user",
                text: "A question.",
                sourceSeqEnd: 7,
                threadId: "thr_main",
                turnId: "turn_1",
              }),
              conversationRow({
                id: "assistant_row",
                role: "assistant",
                text: "An answer.",
                sourceSeqEnd: 9,
                threadId: "thr_main",
                turnId: "turn_1",
              }),
            ]}
            threadRuntimeDisplayStatus="idle"
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(menuItemsOf("user_row")).not.toContain(
      "Fork conversation from here",
    );
    expect(menuItemsOf("assistant_row")).toContain(
      "Fork conversation from here",
    );
    const row = document.querySelector<HTMLElement>(
      '[data-timeline-row-id="assistant_row"]',
    )!;
    fireEvent.pointerDown(
      within(row).getByRole("button", { name: "Message actions" }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Fork conversation from here" }),
    );
    expect(ran).toEqual([
      {
        threadId: "thr_main",
        messageId: "assistant_row",
        turnId: "turn_1",
        role: "assistant",
        sourceSeqEnd: 9,
      },
    ]);
  });
});
