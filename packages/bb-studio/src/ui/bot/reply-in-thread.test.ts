// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { SideThreadView } from "../../contract";
import { mountSideThreadRows, sideThreadLabel, threadInPath } from "./reply-in-thread";

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

it("shows Reply in thread only on a Bot chat's replies, and the reply count under a reply with a side thread", async () => {
  document.body.innerHTML = page;
  history.replaceState(null, "", "/threads/thr_bot");
  const controller = new AbortController();
  const load = vi.fn(async (threadId: string) => ({ chat: threadId === "thr_bot", threads: threadId === "thr_bot" ? [thread()] : [] }));
  mountSideThreadRows(controller.signal, load);
  // Hidden until it's known to be a Bot chat.
  expect(shown("reply")).toBe(false);
  await settle();
  expect([shown("reply"), shown("mine"), shown("other")]).toEqual([true, false, true]);
  expect(rowOf("thr_bot:assistant:a1")?.textContent).toMatch(/^💬 2 replies · /);
  expect(rowOf("thr_bot:assistant:a2")).toBeNull();

  // The row opens the side thread through the reply's own action.
  const clicked = vi.fn();
  document.getElementById("reply")!.addEventListener("click", clicked);
  rowOf("thr_bot:assistant:a1")!.click();
  expect(clicked).toHaveBeenCalledOnce();

  // Another thread: no action, no rows.
  history.replaceState(null, "", "/threads/thr_other");
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await settle();
  expect(shown("reply")).toBe(false);
  expect(rowOf("thr_bot:assistant:a1")).toBeNull();

  controller.abort();
  expect([shown("reply"), shown("mine")]).toEqual([true, true]);
});
