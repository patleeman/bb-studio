// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExperimentalMessageActionMessage } from "@get-bb/plugin-sdk";
import type { PluginMessageActionMenuSlot } from "@/lib/fork-slots";
import {
  forkMessageMenuActions,
  withForkMessageMenu,
} from "./forkMessageActions";
import { MessageActionBar } from "./MessageActionBar";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ROW = {
  id: "msg_2",
  threadId: "thr_main",
  role: "assistant" as const,
  turnId: "turn_2",
  sourceSeqEnd: 41,
};

function slot(
  pluginId: string,
  id: string,
  extra: Partial<PluginMessageActionMenuSlot> = {},
): PluginMessageActionMenuSlot {
  return {
    pluginId,
    id,
    generation: 1,
    title: `${pluginId} ${id}`,
    run: () => {},
    ...extra,
  };
}

describe("message menu actions from plugins", () => {
  it("lists available items in plugin-id order and hands each the message it is on", () => {
    const ran: ExperimentalMessageActionMessage[] = [];
    const seen: ExperimentalMessageActionMessage[] = [];
    const actions = forkMessageMenuActions(
      [
        slot("zeta", "later"),
        slot("studio", "fork", {
          isAvailable: (message) => {
            seen.push(message);
            return message.role === "assistant";
          },
          run: (message) => {
            ran.push(message);
          },
        }),
        slot("studio", "never", { isAvailable: () => false }),
        slot("studio", "broken", {
          isAvailable: () => {
            throw new Error("boom");
          },
        }),
      ],
      ROW,
    );
    expect(actions.map((action) => action.label)).toEqual([
      "studio fork",
      "zeta later",
    ]);
    actions[0]!.onSelect();
    const message = {
      threadId: "thr_main",
      messageId: "msg_2",
      turnId: "turn_2",
      role: "assistant",
      sourceSeqEnd: 41,
    };
    expect(seen).toEqual([message]);
    expect(ran).toEqual([message]);
  });

  it("contains a failing run and leaves the row's other actions alone", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const existing = [
      {
        key: "demo/summarize/1",
        pluginId: "demo",
        icon: "Zap",
        label: "Summarize",
        onSelect: () => {},
      },
    ];
    expect(withForkMessageMenu([], ROW, existing)).toBe(existing);
    const actions = withForkMessageMenu(
      [
        slot("studio", "sync", {
          run: () => {
            throw new Error("sync");
          },
        }),
        slot("studio", "async", { run: () => Promise.reject(new Error("a")) }),
      ],
      ROW,
      existing,
    )!;
    expect(actions.map((action) => action.label)).toEqual([
      "Summarize",
      "studio async",
      "studio sync",
    ]);
    expect(() => actions[1]!.onSelect()).not.toThrow();
    expect(() => actions[2]!.onSelect()).not.toThrow();
    await Promise.resolve();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("puts plugin menu items in the message's ··· menu, before Fork, and never inline", () => {
    const run = vi.fn();
    const pluginActions = withForkMessageMenu(
      [
        slot("studio", "fork-conversation", {
          title: "Fork conversation from here",
          run,
        }),
      ],
      ROW,
      [
        {
          key: "demo/summarize/1",
          pluginId: null,
          icon: "Zap",
          label: "Summarize",
          onSelect: () => {},
        },
      ],
    );
    render(
      <MessageActionBar
        timestamp={Date.UTC(2026, 10, 11)}
        messageText="An answer."
        alignment="start"
        mobileActionDisplay="inline"
        onAddToChat={vi.fn()}
        onFork={vi.fn()}
        pluginActions={pluginActions}
      />,
    );
    expect(screen.getByRole("button", { name: "Summarize" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Fork conversation from here" }),
    ).toBeNull();
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Message actions" }),
    );
    const menu = screen.getByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Add to chat",
      "Fork conversation from here",
      "Fork into new thread",
    ]);
    fireEvent.click(
      within(menu).getByRole("menuitem", {
        name: "Fork conversation from here",
      }),
    );
    expect(run).toHaveBeenCalledWith({
      threadId: "thr_main",
      messageId: "msg_2",
      turnId: "turn_2",
      role: "assistant",
      sourceSeqEnd: 41,
    });
  });
  it("hides bb's Fork item on a message where a plugin item replaces it, and keeps it elsewhere", () => {
    const replacing = slot("studio", "fork-conversation", {
      title: "Fork conversation from here",
      isAvailable: (message) => message.threadId === "thr_main",
      experimental_replaces: "thread.fork",
    });
    const labels = (threadId: string) => {
      cleanup();
      render(
        <MessageActionBar
          timestamp={Date.UTC(2026, 10, 11)}
          messageText="An answer."
          alignment="start"
          mobileActionDisplay="inline"
          onFork={vi.fn()}
          pluginActions={withForkMessageMenu(
            [replacing, slot("zeta", "plain")],
            { ...ROW, threadId },
            undefined,
          )}
        />,
      );
      fireEvent.pointerDown(
        screen.getByRole("button", { name: "Message actions" }),
      );
      return within(screen.getByRole("menu"))
        .getAllByRole("menuitem")
        .map((item) => item.textContent);
    };
    expect(labels("thr_main")).toEqual([
      "Fork conversation from here",
      "zeta plain",
    ]);
    expect(labels("thr_other")).toEqual(["zeta plain", "Fork into new thread"]);
  });
});
