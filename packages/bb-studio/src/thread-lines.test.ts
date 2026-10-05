import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { expect, it, vi } from "vitest";
import { createThreadLines, parseThreadStatus, spaceThreadStatus, STATUS_THREAD_LIMIT, STATUS_EVENT_LIMIT } from "./thread-lines";

const thread = { id: "t", title: "Worker", status: "idle", isLead: false, updatedAt: 1000 };
const row = (type: string, at: number, data: unknown, extra: object = {}) => ({ id: `e${at}`, type, createdAt: at, threadId: "t", scope: { kind: "turn", turnId: "turn1" }, data, ...extra });
const message = (at: number, text: string, extra: object = {}) => row("item/completed", at, { item: { type: "agentMessage", text, ...extra } });
const sdkWith = (list?: unknown) => ({ threads: list ? { events: { list } } : {} }) as Pick<BbPluginApi["sdk"], "threads">;

it("uses latest completed assistant prose, coalesces a turn, and never infers completion from idle", async () => {
  const events = [message(10, "Checking tests."), message(30, "Tests pass. ```sh\nprivate command\n``` Ready for review."), row("item/agentMessage/delta", 40, { delta: "stream spam" }), message(20, "Older turn", { parentToolCallId: "nested" })];
  const parsed = parseThreadStatus(thread, events);
  expect(parsed.progress).toEqual({ progress: "Tests pass. Ready for review.", progressAt: 30, failureReason: null, blockedReason: null });
  expect(parsed.activity).toEqual([{ id: "e30", threadId: "t", title: "Worker", isLead: false, kind: "progress", summary: "Tests pass. Ready for review.", at: 30 }]);
  const result = await spaceThreadStatus(sdkWith(async () => events), [thread]);
  expect(result.threads[0]?.status).toBe("idle");
});

it("ignores malformed rows, wrong-thread events, reasoning, inputs and tool payloads", () => {
  const events = [null, {}, row("item/completed", NaN, {}), row("item/completed", 20, { item: { type: "agentMessage", text: 3 } }), message(21, "Wrong thread", { }), row("item/completed", 22, { item: { type: "commandExecution", command: "private command", aggregatedOutput: "private output" } }), row("item/completed", 23, { item: { type: "userMessage", content: [{ text: "private input" }] } }), row("item/completed", 24, { item: { type: "reasoning", text: "private thoughts" } }), message(25, " ```sh\nprivate command\n``` "), message(26, " `private command` ")];
  events[4] = { ...events[4] as object, threadId: "elsewhere" };
  expect(parseThreadStatus(thread, events)).toEqual({ progress: { progress: null, progressAt: null, failureReason: null, blockedReason: null }, activity: [] });
  expect(parseThreadStatus(thread, { events })).toEqual(parseThreadStatus(thread, []));
});

it("bounds summaries and scans even for invalid oversized API responses", () => {
  expect(parseThreadStatus(thread, [message(1, "a".repeat(2000))]).progress.progress).toHaveLength(240);
  expect(parseThreadStatus(thread, [...Array(STATUS_EVENT_LIMIT).fill(null), message(2, "Outside scan")]).progress.progress).toBeNull();
});

it("extracts failed turn and provider/system error evidence without tool detail", () => {
  expect(parseThreadStatus(thread, [row("turn/completed", 30, { status: "failed", error: { message: "Quota exhausted.", command: "secret" } })]).progress.failureReason).toBe("Quota exhausted.");
  expect(parseThreadStatus(thread, [row("turn/completed", 30, { status: "failed", error: { message: 99 } })]).progress.failureReason).toBe("The latest turn failed.");
  for (const type of ["provider/error", "system/error"]) {
    expect(parseThreadStatus(thread, [row(type, 30, { message: "Authentication failed.", detail: "private input" })]).progress.failureReason).toBe("Authentication failed.");
  }
  expect(parseThreadStatus(thread, [row("provider/error", 30, { message: "Retrying.", willRetry: true })]).progress.failureReason).toBeNull();
});

it("does not show a recovered historical failure or call a successful turn a completed task", () => {
  for (const latest of [row("turn/started", 40, {}), row("turn/completed", 40, { status: "completed" }), row("turn/completed", 40, { status: "interrupted" })]) {
    const events = [row("turn/completed", 20, { status: "failed", error: { message: "Old failure" } }), row("system/error", 21, { message: "Old error" }), latest];
    expect(parseThreadStatus(thread, events).progress.failureReason).toBeNull();
  }
  expect(parseThreadStatus(thread, [row("turn/completed", 20, { status: "completed" })]).activity).toEqual([]);
  expect(parseThreadStatus(thread, [row("turn/started", 20, {}), row("system/error", 30, { message: "New failure" })]).progress.failureReason).toBe("New failure");
});

it("uses pending lifecycle evidence for blockers and latest resolution per interaction id", () => {
  const approval = (at: number, status: string) => row("system/interaction/lifecycle", at, { interaction: { id: "approval", payload: { kind: "approval", subject: { command: "private command" }, reason: "private input" }, status } });
  expect(parseThreadStatus(thread, [approval(10, "pending")]).progress.blockedReason).toBe("Waiting for approval.");
  expect(parseThreadStatus(thread, [approval(10, "pending"), approval(20, "resolved")]).progress.blockedReason).toBeNull();
  const question = (at: number, status: string) => row("system/userQuestion/lifecycle", at, { interactionId: "question", status, payload: { questions: ["private question"] } });
  expect(parseThreadStatus(thread, [question(30, "pending")]).progress.blockedReason).toBe("Waiting for a user response.");
  expect(parseThreadStatus(thread, [question(30, "pending"), question(40, "interrupted")]).progress.blockedReason).toBeNull();
  expect(parseThreadStatus(thread, [approval(10, "pending"), approval(20, "resolved"), question(30, "pending")]).activity[0]?.summary).toBe("Waiting for a user response.");
});

it("degrades gracefully when events are absent, throw, reject or return invalid data", async () => {
  for (const sdk of [sdkWith(), sdkWith(() => { throw new Error("unsupported"); }), sdkWith(async () => { throw new Error("transport"); }), sdkWith(async () => ({ invalid: true }))]) {
    const result = await spaceThreadStatus(sdk, [thread]);
    expect(result.threads).toEqual([{ ...thread, progress: null, progressAt: null, failureReason: null, blockedReason: null }]);
    expect(result.activity).toEqual([]);
  }
});

it("bounds requests and concurrency, includes the lead and orders global activity by event timestamp", async () => {
  let inflight = 0, peak = 0;
  const list = vi.fn(async ({ threadId }: { threadId: string }) => {
    inflight++; peak = Math.max(peak, inflight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inflight--;
    const at = threadId === "lead" ? 2000 : Number(threadId.slice(1));
    return [message(at, `Progress ${threadId}`)].map((event) => ({ ...event, threadId }));
  });
  const threads = [...Array.from({ length: 60 }, (_, i) => ({ ...thread, id: `t${i}`, updatedAt: i })), { ...thread, id: "lead", isLead: true, updatedAt: 0 }];
  const result = await spaceThreadStatus(sdkWith(list), threads);
  expect(list).toHaveBeenCalledTimes(STATUS_THREAD_LIMIT);
  expect(list.mock.calls[0]?.[0].threadId).toBe("lead");
  expect(peak).toBeLessThanOrEqual(4);
  for (const [args] of list.mock.calls) expect(args).toMatchObject({ order: "desc", limit: String(STATUS_EVENT_LIMIT), signal: expect.any(AbortSignal) });
  expect(result.threads).toHaveLength(61);
  expect(result.threads.find((item) => item.id === "t0")?.progress).toBeNull();
  expect(result.activity).toHaveLength(20);
  expect(result.activity[0]).toMatchObject({ threadId: "lead", at: 2000, isLead: true });
  expect(result.activity.map((item) => item.at)).toEqual(result.activity.map((item) => item.at).sort((a, b) => b - a));
});

it("caps activity across turns and uses event sequence to break timestamp ties", () => {
  const events = Array.from({ length: 8 }, (_, index) => ({ ...message(index + 1, `Turn ${index}`), scope: { kind: "turn", turnId: `turn${index}` } }));
  const result = parseThreadStatus(thread, events);
  expect(result.activity.map((item) => item.at)).toEqual([8, 7, 6]);
  expect(result.progress.progress).toBe("Turn 7");
  const tied = [{ ...message(10, "Old"), seq: 1 }, { ...message(10, "Latest"), seq: 2 }];
  expect(parseThreadStatus(thread, tied).progress.progress).toBe("Latest");
});

it("shares a scan deadline and stops scheduling requests when it expires", async () => {
  const controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  const list = vi.fn(async () => { controller.abort(); throw new Error("deadline"); });
  try {
    const result = await spaceThreadStatus(sdkWith(list), Array.from({ length: 40 }, (_, i) => ({ ...thread, id: `t${i}` })));
    expect(timeout).toHaveBeenCalledWith(3000);
    expect(list).toHaveBeenCalledTimes(1);
    expect(result.threads).toHaveLength(40);
    expect(result.threads.every((item) => item.progress === null)).toBe(true);
  } finally { timeout.mockRestore(); }
});

it("reads each thread's latest line once and serves it from cache", async () => {
  const list = vi.fn(async () => [message(10, "Wrote the release notes")]);
  const lines = createThreadLines(sdkWith(list), 60_000);
  expect(await lines.read(["t"])).toEqual({ t: { text: "Wrote the release notes", kind: "progress", at: 10 } });
  await lines.read(["t"]);
  expect(list).toHaveBeenCalledTimes(1);
});
