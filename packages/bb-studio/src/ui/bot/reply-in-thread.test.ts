// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { SideThreadView } from "../../contract";
import { mountSideThreadRows, OPEN_SIDE_THREAD_EVENT, sideThreadLabel, threadInPath } from "./reply-in-thread";

// As stable BB draws a chat: rows marked with their message id, no role attributes,
// the message wrapper's classes, and the action bar with BB's own icons.
const page = `
  <div data-timeline-row-id="thr_bot:user-seed:1"><div class="group/message ml-auto flex w-fit"><div data-message-column><button id="mine" aria-label="Reply in thread"><svg></svg></button></div></div></div>
  <div data-timeline-row-id="thr_bot:assistant:a1"><div class="group/message w-full text-sm" data-message-column><button id="reply" aria-label="Reply in thread"><svg></svg></button><button id="other" aria-label="👍"><svg></svg></button></div></div>
  <div data-timeline-row-id="thr_bot:assistant:a2"><div class="group/message w-full text-sm" data-message-column><button id="reply2" aria-label="Reply in thread"><svg></svg></button></div></div>`;
const shown = (id: string) => (document.getElementById(id) as HTMLElement).style.display !== "none";
const rowOf = (messageId: string) => document.querySelector(`[data-timeline-row-id="${messageId}"] [data-studio-side-thread]`) as HTMLButtonElement | null;
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
const thread = (fields: Partial<SideThreadView> = {}): SideThreadView => ({ messageId: "thr_bot:assistant:a1", threadId: "fork1", replies: 2, lastReplyAt: Date.now() - 5 * 60_000, working: false, ...fields });
afterEach(() => { document.body.replaceChildren(); history.replaceState(null, "", "/"); });

it("finds the thread in BB's paths", () => {
  expect(threadInPath("/threads/thr_a")).toBe("thr_a");
  expect(threadInPath("/projects/proj_1/threads/thr_b/files")).toBe("thr_b");
  expect(threadInPath("/plugins/studio/bot")).toBeNull();
});

it("labels a side thread by its replies", () => {
  expect(sideThreadLabel(thread({ replies: 1, lastReplyAt: null }))).toBe("1 reply");
  expect(sideThreadLabel(thread({ replies: 0 }))).toBe("Thread");
  expect(sideThreadLabel(thread({ replies: 0, working: true }))).toBe("Working…");
  expect(sideThreadLabel(thread({ working: true }))).toBe("2 replies · working…");
});

it("draws the reply count under a Bot reply with side threads, and asks to open the newest on click", async () => {
  document.body.innerHTML = page;
  history.replaceState(null, "", "/threads/thr_bot");
  const controller = new AbortController();
  const load = vi.fn(async (threadId: string) => ({ chat: threadId === "thr_bot", threads: threadId === "thr_bot" ? [thread()] : [] }));
  mountSideThreadRows(controller.signal, load);
  await settle();
  expect(rowOf("thr_bot:assistant:a1")?.textContent).toMatch(/^💬 2 replies · /);
  expect(rowOf("thr_bot:assistant:a2")).toBeNull();
  // BB's own actions are left as they are.
  expect([shown("reply"), shown("mine"), shown("other")]).toEqual([true, true, true]);

  const opened = vi.fn();
  window.addEventListener(OPEN_SIDE_THREAD_EVENT, (event) => opened((event as CustomEvent).detail));
  rowOf("thr_bot:assistant:a1")!.click();
  expect(opened).toHaveBeenCalledWith({ threadId: "fork1" });

  // Another thread: no rows.
  history.replaceState(null, "", "/threads/thr_other");
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await settle();
  expect(rowOf("thr_bot:assistant:a1")).toBeNull();

  controller.abort();
  expect(document.querySelector("[data-studio-side-thread]")).toBeNull();
});
