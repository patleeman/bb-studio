// @vitest-environment jsdom
import type { BbNavigate } from "@get-bb/plugin-sdk/app";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OPEN_IN_SPACE_EVENT, listenForOpens } from "./open-in-space";
import { SPACE_ITEM_ACTION, SPACE_THREAD_ACTION } from "./tabs";

function fakeNavigate(accept = true) {
  return { openThreadPanel: vi.fn(() => accept), toThread: vi.fn() } as unknown as BbNavigate & { openThreadPanel: ReturnType<typeof vi.fn>; toThread: ReturnType<typeof vi.fn> };
}

const ask = (detail: unknown) => {
  const event = new CustomEvent(OPEN_IN_SPACE_EVENT, { detail, cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

afterEach(() => sessionStorage.clear());

describe("Opening a Space's item or thread beside a thread", () => {
  it("answers requests for its own thread with a workbench tab", () => {
    const navigate = fakeNavigate();
    const stop = listenForOpens("thr_lead", navigate);
    expect(ask({ threadId: "thr_lead", request: { kind: "item", path: "/plugins/pages/pages/pg_1", title: "Plan" } })).toBe(true);
    expect(navigate.openThreadPanel).toHaveBeenCalledWith({ actionId: SPACE_ITEM_ACTION, title: "Plan", params: { path: "/plugins/pages/pages/pg_1", title: "Plan" } });
    expect(ask({ threadId: "thr_lead", request: { kind: "thread", threadId: "thr_w", title: "Worker" } })).toBe(true);
    expect(navigate.openThreadPanel).toHaveBeenLastCalledWith({ actionId: SPACE_THREAD_ACTION, title: "Worker", params: { threadId: "thr_w" } });
    stop();
  });

  it("ignores other threads and malformed requests", () => {
    const navigate = fakeNavigate();
    const stop = listenForOpens("thr_lead", navigate);
    expect(ask({ threadId: "thr_other", request: { kind: "status" } })).toBe(false);
    expect(ask({ threadId: "thr_lead", request: { kind: "item", path: "javascript:alert(1)", title: "x" } })).toBe(false);
    expect(navigate.openThreadPanel).not.toHaveBeenCalled();
    stop();
  });

  it("picks up a request left before the thread opened, once", () => {
    sessionStorage.setItem(OPEN_IN_SPACE_EVENT, JSON.stringify({ threadId: "thr_lead", request: { kind: "status" } }));
    const navigate = fakeNavigate();
    listenForOpens("thr_lead", navigate)();
    listenForOpens("thr_lead", navigate)();
    expect(navigate.openThreadPanel).toHaveBeenCalledTimes(1);
  });

  it("goes to the thread when there's no side panel to open it in", () => {
    const navigate = fakeNavigate(false);
    const stop = listenForOpens("thr_lead", navigate);
    ask({ threadId: "thr_lead", request: { kind: "thread", threadId: "thr_w", title: "Worker" } });
    expect(navigate.toThread).toHaveBeenCalledWith("thr_w");
    stop();
  });
});
