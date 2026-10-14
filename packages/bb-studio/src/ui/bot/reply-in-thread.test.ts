// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { mountReplyInThreadVisibility, threadInPath } from "./reply-in-thread";

// As stable BB draws the bar: no role attributes, BB's own icon, the message wrapper's classes.
const page = `
  <div class="group/message w-full text-sm"><div><button id="reply" aria-label="Reply in thread"><svg></svg></button></div></div>
  <div class="group/message ml-auto flex w-fit"><div><button id="mine" aria-label="Reply in thread"><svg></svg></button></div></div>
  <div class="group/message w-full text-sm"><div><button id="other" aria-label="👍"><svg></svg></button></div></div>`;
const shown = (id: string) => (document.getElementById(id) as HTMLElement).style.display !== "none";
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
afterEach(() => { document.body.replaceChildren(); history.replaceState(null, "", "/"); });

it("finds the thread in BB's paths", () => {
  expect(threadInPath("/threads/thr_a")).toBe("thr_a");
  expect(threadInPath("/projects/proj_1/threads/thr_b/files")).toBe("thr_b");
  expect(threadInPath("/plugins/studio/bot")).toBeNull();
});

it("shows Reply in thread only on a Bot chat's replies, and restores on abort", async () => {
  document.body.innerHTML = page;
  history.replaceState(null, "", "/threads/thr_bot");
  const controller = new AbortController();
  mountReplyInThreadVisibility(controller.signal, async (threadId) => threadId === "thr_bot");
  // Hidden until it's known to be a Bot chat.
  expect(shown("reply")).toBe(false);
  await settle();
  expect([shown("reply"), shown("mine"), shown("other")]).toEqual([true, false, true]);

  history.replaceState(null, "", "/threads/thr_other");
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 1100));
  expect(shown("reply")).toBe(false);

  controller.abort();
  expect([shown("reply"), shown("mine")]).toEqual([true, true]);
});
