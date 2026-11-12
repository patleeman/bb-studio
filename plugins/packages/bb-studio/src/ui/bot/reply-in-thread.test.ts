// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { SideThreadView } from "../../contract";
import { isChatReply, mountSideThreadRows, sideThreadLabel, threadInPath, type ThreadFooter } from "./reply-in-thread";

const page = `
  <div data-timeline-row-id="thr_bot:user-seed:1"><div class="group/message ml-auto flex w-fit"><div data-message-column><button id="mine" aria-label="Reply in thread"><svg></svg></button></div></div></div>
  <div data-timeline-row-id="thr_bot:assistant:a1"><div class="group/message w-full text-sm" data-message-column><button id="reply" aria-label="Reply in thread"><svg></svg></button><button id="other" aria-label="👍"><svg></svg></button></div></div>
  <div data-timeline-row-id="thr_bot:assistant:a2"><div class="group/message w-full text-sm" data-message-column><button id="reply2" aria-label="Reply in thread"><svg></svg></button></div></div>
  <div data-timeline-row-id="thr_bot:t3:turn:0"><div data-timeline-row-id="thr_bot:assistant:a3"><div class="group/message w-full text-sm" data-message-column></div></div></div>
  <aside><div data-timeline-row-id="thr_side:assistant:s1"><div class="group/message w-full text-sm" data-message-column></div></div></aside>`;
const shown = (id: string) => (document.getElementById(id) as HTMLElement).style.display !== "none";
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
const thread = (fields: Partial<SideThreadView> = {}): SideThreadView => ({ messageId: "thr_bot:assistant:a1", threadId: "fork1", botId: "dot", replies: 2, lastReplyAt: Date.now() - 5 * 60_000, lastReplyRole: "assistant", working: false, kind: "reply", conversations: 1, ...fields });
afterEach(() => { document.body.replaceChildren(); history.replaceState(null, "", "/"); });

it("finds the thread in BB's paths", () => {
  expect(threadInPath("/threads/thr_a")).toBe("thr_a");
  expect(threadInPath("/projects/proj_1/threads/thr_b/files")).toBe("thr_b");
  expect(threadInPath("/plugins/studio/bot")).toBeNull();
});

it("labels a reply thread by its count and the last reply's time, and a fork by its conversations", () => {
  const now = new Date(2026, 10, 12, 18, 0).getTime();
  expect(sideThreadLabel(thread({ lastReplyAt: new Date(2026, 10, 12, 16, 13).getTime() }), now, "en-US")).toBe("2 replies · Last reply 4:13 PM");
  expect(sideThreadLabel(thread({ replies: 1, lastReplyAt: new Date(2026, 10, 3, 9, 0).getTime() }), now, "en-US")).toBe("1 reply · Last reply Nov 3");
  expect(sideThreadLabel(thread({ replies: 1, lastReplyAt: null }))).toBe("1 reply");
  expect(sideThreadLabel(thread({ replies: 0 }))).toBeNull();
  expect(sideThreadLabel(thread({ replies: 0, working: true }))).toBe("Replying…");
  expect(sideThreadLabel(thread({ working: true }))).toBe("Replying…");
  expect(sideThreadLabel(thread({ kind: "fork", conversations: 1 }))).toBe("Forked here · 1 conversation");
  expect(sideThreadLabel(thread({ kind: "fork", conversations: 2 }))).toBe("Forked here · 2 conversations");
});

it("tells this chat's replies from your messages, other rows and a side thread's own chat", () => {
  document.body.innerHTML = page;
  const rows = [...document.querySelectorAll<HTMLElement>("[data-timeline-row-id]")];
  expect(rows.filter((row) => isChatReply(row, "thr_bot")).map((row) => row.getAttribute("data-timeline-row-id")))
    .toEqual(["thr_bot:assistant:a1", "thr_bot:assistant:a2", "thr_bot:assistant:a3"]);
});

it("makes no footer under replies without threads", async () => {
  document.body.innerHTML = page;
  history.replaceState(null, "", "/threads/thr_bot");
  const controller = new AbortController();
  const show = vi.fn();
  mountSideThreadRows(controller.signal, async (threadId) => ({ chat: threadId === "thr_bot", threads: [] as SideThreadView[] }), show);
  await settle();
  expect(document.querySelector("[data-studio-thread-footer]")).toBeNull();
  expect(show).toHaveBeenLastCalledWith([]);
  controller.abort();
});

it("hands a footer under each reply with threads to the indicator, and takes them back elsewhere", async () => {
  document.body.innerHTML = page;
  history.replaceState(null, "", "/threads/thr_bot");
  const controller = new AbortController();
  const load = vi.fn(async (threadId: string) => ({ chat: threadId === "thr_bot", threads: threadId === "thr_bot" ? [thread()] : [] }));
  let footers: readonly ThreadFooter[] = [];
  mountSideThreadRows(controller.signal, load, (next) => { footers = next; });
  await settle();
  expect(footers.map((each) => [each.key, each.sourceThreadId, each.threads[0]!.threadId])).toEqual([["thr_bot:assistant:a1", "thr_bot", "fork1"]]);
  expect(footers[0]!.host.closest("[data-timeline-row-id]")?.getAttribute("data-timeline-row-id")).toBe("thr_bot:assistant:a1");
  expect([shown("reply"), shown("mine"), shown("other")]).toEqual([true, true, true]);
  const before = footers;
  footers[0]!.host.append(document.createElement("span"));
  await settle();
  expect(footers).toBe(before);

  history.replaceState(null, "", "/threads/thr_other");
  await new Promise((resolve) => setTimeout(resolve, 1100));
  await settle();
  expect(footers).toEqual([]);
  expect(document.querySelector("[data-studio-thread-footer]")).toBeNull();
  controller.abort();
});

it("hides bb's Provisioned thread row and keeps the conversation's own rows", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const style = document.createElement("style");
  style.textContent = readFileSync(join(__dirname, "timeline.css"), "utf8");
  document.head.append(style);
  document.body.innerHTML = `<div id="prov" data-timeline-row-id="thr_bot:op:thread-provisioning:3"></div><div id="msg" data-timeline-row-id="thr_bot:assistant:a1"></div>`;
  expect(getComputedStyle(document.getElementById("prov")!).display).toBe("none");
  expect(getComputedStyle(document.getElementById("msg")!).display).not.toBe("none");
  style.remove();
});
