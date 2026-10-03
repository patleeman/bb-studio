// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PageTitle, TitleRecovery, type TitleTransport } from "./page-title";

const origin = "https://bb.example";
const controllers: PageTitle[] = [];
const stores: TitleRecovery[] = [];
const flush = () => vi.advanceTimersByTimeAsync(400);
const tick = () => vi.advanceTimersByTimeAsync(0);
function setup(id = "page_one", host = origin) {
  let page: { title: string; updatedAt: number } | null = { title: "Original", updatedAt: 1 };
  const transport: TitleTransport = {
    update: vi.fn(async input => {
      if (!page) throw new Error("Page not found.");
      if (input.expectedTitle !== page.title) throw new Error("Page title changed.");
      page = { title: input.title, updatedAt: page.updatedAt + 1 };
      return { page };
    }),
    get: vi.fn(async () => ({ page })),
  };
  const recovery = new TitleRecovery(host, id);
  stores.push(recovery);
  const mount = () => {
    const controller = new PageTitle(id, page ?? { title: "Original", updatedAt: 1 }, transport, recovery);
    controllers.push(controller);
    return controller;
  };
  return { mount, transport, recovery, change: (title: string) => { page = { title, updatedAt: (page?.updatedAt ?? 1) + 1 }; }, remove: () => { page = null; } };
}
beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); });
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  vi.useRealTimers(); vi.restoreAllMocks();
  for (const recovery of stores.splice(0)) for (const draft of recovery.memory()) recovery.remove(draft);
});

it("persists the latest keystroke before debounce and restores it without an automatic write", async () => {
  const state = setup();
  const first = state.mount(); first.edit("Typed just before leaving"); first.dispose();
  const restored = state.mount();
  expect(restored.snapshot).toMatchObject({ title: "Typed just before leaving", status: "recovered", localError: null });
  await flush(); expect(state.transport.update).not.toHaveBeenCalled();
  restored.retry(); await tick();
  expect(state.transport.update).toHaveBeenCalledWith({ id: "page_one", title: "Typed just before leaving", expectedTitle: "Original" });
  expect(restored.snapshot.status).toBe("saved"); expect(state.recovery.load()).toEqual([]);
});

it("keeps a rejected save through reload and retries explicitly", async () => {
  const state = setup(); const first = state.mount();
  vi.mocked(state.transport.update).mockRejectedValueOnce(new Error("Offline"));
  first.edit("My draft"); await flush();
  expect(first.snapshot).toMatchObject({ title: "My draft", status: "failed", error: "Offline" });
  first.dispose(); const restored = state.mount(); restored.retry(); await tick();
  expect(restored.snapshot).toMatchObject({ title: "My draft", status: "saved" });
});

it("does not replace another writer's title during recovery, including a second conflict", async () => {
  const state = setup(); const first = state.mount(); first.edit("Mine"); first.dispose();
  state.change("Someone else's title"); const restored = state.mount(); restored.retry(); await tick();
  expect(restored.snapshot).toMatchObject({ title: "Mine", currentTitle: "Someone else's title", status: "conflict" });
  expect(state.recovery.load()[0]?.title).toBe("Mine");
  state.change("Changed again"); restored.useMine(); await tick();
  expect(restored.snapshot).toMatchObject({ status: "conflict", currentTitle: "Changed again" });
  restored.useMine(); await tick();
  expect(restored.snapshot).toMatchObject({ status: "saved", title: "Mine" });
});

it("serializes writes and preserves newer typing while an older save is pending", async () => {
  const state = setup(); const controller = state.mount();
  const normal = state.transport.update;
  let resolve!: (value: Awaited<ReturnType<TitleTransport["update"]>>) => void;
  vi.mocked(state.transport.update).mockImplementationOnce(() => new Promise(finish => { resolve = finish; }));
  controller.edit("First"); await flush(); controller.edit("Newer"); await flush();
  expect(state.transport.update).toHaveBeenCalledTimes(1);
  state.change("First"); resolve({ page: { title: "First", updatedAt: 2 } }); await tick();
  expect(controller.snapshot.title).toBe("Newer");
  expect(state.recovery.load()[0]).toMatchObject({ title: "Newer", base: "First" });
  await flush();
  expect(normal).toHaveBeenLastCalledWith({ id: "page_one", title: "Newer", expectedTitle: "First" });
  expect(controller.snapshot).toMatchObject({ status: "saved", title: "Newer" });
});

it("retains newer typing if an older request and its verification read both fail", async () => {
  const state = setup(); const controller = state.mount();
  let reject!: (error: Error) => void;
  vi.mocked(state.transport.update).mockImplementationOnce(() => new Promise((_finish, fail) => { reject = fail; }));
  vi.mocked(state.transport.get).mockRejectedValueOnce(new Error("Offline"));
  controller.edit("First"); await flush(); controller.edit("Newer");
  reject(new Error("Save failed")); await tick();
  expect(controller.snapshot).toMatchObject({ title: "Newer", status: "failed" });
  controller.dispose(); expect(state.mount().snapshot.title).toBe("Newer");
});

it("recovers a committed write whose response was lost without mistaking it for a conflict", async () => {
  const state = setup(); const controller = state.mount();
  vi.mocked(state.transport.update).mockImplementationOnce(async input => { state.change(input.title); throw new Error("Response lost"); });
  controller.edit("Saved already"); await flush();
  expect(controller.snapshot.status).toBe("saved"); expect(state.recovery.load()).toEqual([]);
});

it("keeps captured page and origin identities across pending saves and navigation", async () => {
  const first = setup(); const one = first.mount();
  let reject!: (error: Error) => void;
  vi.mocked(first.transport.update).mockImplementationOnce(() => new Promise((_finish, fail) => { reject = fail; }));
  one.edit("Page one"); await flush(); one.dispose();
  const second = setup("page_two"); const two = second.mount(); two.edit("Page two");
  const otherHost = setup("page_one", "https://other.example"); expect(otherHost.mount().snapshot.title).toBe("Original");
  reject(new Error("Late failure")); await tick(); await flush();
  expect(first.transport.get).toHaveBeenCalledWith({ id: "page_one" });
  expect(first.recovery.load()[0]?.title).toBe("Page one");
  expect(two.snapshot).toMatchObject({ title: "Page two", status: "saved" });
});

it("keeps distinct recovery from concurrent views and lets the user select it", async () => {
  const state = setup(); const one = state.mount(); const two = state.mount();
  one.edit("One"); two.edit("Two"); one.dispose(); two.dispose();
  expect(state.recovery.load().map(draft => draft.title).sort()).toEqual(["One", "Two"]);
  const restored = state.mount();
  const alternative = restored.snapshot.alternatives[0]!;
  restored.choose(alternative.id);
  expect(restored.snapshot.title).toBe(alternative.title);
  restored.discard();
  expect(state.recovery.load()).toHaveLength(1);
  expect(restored.snapshot.alternatives).toHaveLength(1);
});

it("reports storage failure honestly and still keeps the in-memory draft after a network failure", async () => {
  const state = setup(); const controller = state.mount();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota exceeded"); });
  vi.mocked(state.transport.update).mockRejectedValue(new Error("Offline"));
  controller.edit("Keep this open"); await flush();
  expect(controller.snapshot).toMatchObject({ title: "Keep this open", localError: "Quota exceeded", status: "failed" });
  controller.dispose();
  const restored = state.mount();
  expect(restored.snapshot).toMatchObject({ title: "Keep this open", status: "recovered" });
  expect(restored.snapshot.localError).toContain("only kept");
  const exit = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(exit);
  expect(exit.defaultPrevented).toBe(true);
  vi.restoreAllMocks(); restored.retryLocal();
  expect(restored.snapshot.localError).toBeNull();
  const safeExit = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(safeExit);
  expect(safeExit.defaultPrevented).toBe(false);
});

it("removes a superseded durable title after newer quota recovery saves, without removing another view's draft", async () => {
  const state = setup(); const controller = state.mount(); const independent = state.mount();
  const update = vi.mocked(state.transport.update);
  update.mockRejectedValueOnce(new Error("Offline"));
  controller.edit("Older durable title"); await flush();
  independent.edit("Independent title"); independent.dispose();
  await vi.advanceTimersByTimeAsync(1);
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota exceeded"); });
  update.mockRejectedValueOnce(new Error("Offline"));
  controller.edit("Newest title"); await flush(); controller.dispose();
  write.mockRestore();
  const restored = state.mount();
  expect(restored.snapshot.title).toBe("Newest title");
  expect(restored.snapshot.alternatives.map(draft => draft.title)).toEqual(["Independent title"]);
  restored.retry(); await tick(); restored.dispose();
  expect(state.recovery.load().map(draft => draft.title)).toEqual(["Independent title"]);
  expect(JSON.stringify(state.recovery.exportRecords())).not.toContain("Older durable title");
});

it("keeps one durable predecessor through many memory-only keystrokes", async () => {
  const state = setup(); const controller = state.mount();
  controller.edit("Durable predecessor");
  const predecessor = state.recovery.load()[0]!;
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota exceeded"); });
  for (let index = 0; index < 500; index++) controller.edit(`Newest title ${index}`);
  expect(state.recovery.memory()).toHaveLength(1);
  expect(state.recovery.memory()[0]).toMatchObject({ title: "Newest title 499", supersedes: predecessor.id });
  write.mockRestore(); controller.retry(); await tick();
  expect(state.recovery.load()).toEqual([]);
  expect(state.recovery.exportRecords().records).toEqual({});
});

it("keeps failed cleanup reachable through a bounded record link after a new document loads", async () => {
  const state = setup(); const controller = state.mount();
  controller.edit("Oldest");
  const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("Cleanup blocked"); });
  controller.edit("Middle"); controller.edit("Newest"); controller.dispose();
  expect(Object.keys(state.recovery.exportRecords().records)).toHaveLength(3);
  for (const draft of state.recovery.memory()) state.recovery.forgetMemory(draft);
  const restored = state.mount();
  expect(restored.snapshot.title).toBe("Newest");
  expect(restored.snapshot.alternatives).toEqual([]);
  remove.mockRestore(); restored.retry(); await tick();
  expect(restored.snapshot.status).toBe("saved");
  expect(state.recovery.exportRecords().records).toEqual({});
  restored.dispose(); expect(state.mount().snapshot).toMatchObject({ title: "Newest", status: "saved" });
});

it("retries a failed recovery read without replacing a previously saved title draft", () => {
  const state = setup(); const first = state.mount(); first.edit("Persisted title"); first.dispose();
  // Simulate a new document: only the on-disk version remains.
  for (const draft of state.recovery.memory()) state.recovery.forgetMemory(draft);
  const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Blocked read"); });
  const restored = state.mount(); expect(restored.snapshot.localError).toContain("Could not read");
  expect(restored.snapshot.title).toBe("Original");
  read.mockRestore(); restored.retryLocal();
  expect(restored.snapshot).toMatchObject({ title: "Persisted title", status: "recovered", localError: null });
  expect(state.transport.update).not.toHaveBeenCalled();
});

it("shares memory-only recovery and one removable exit guard across plugin module reloads", async () => {
  const state = setup(); const first = state.mount();
  const addListener = vi.spyOn(window, "addEventListener");
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota exceeded"); });
  first.edit("Survive plugin reload"); first.dispose();
  vi.resetModules();
  const reloaded = await import("./page-title");
  expect(reloaded.PageTitle).not.toBe(PageTitle);
  const recovery = new reloaded.TitleRecovery(origin, "page_one"); stores.push(recovery);
  const restored = new reloaded.PageTitle("page_one", { title: "Original", updatedAt: 1 }, state.transport, recovery);
  controllers.push(restored);
  expect(restored.snapshot).toMatchObject({ title: "Survive plugin reload", status: "recovered" });
  expect(restored.snapshot.localError).toContain("only kept");
  restored.retryLocal();
  expect(addListener.mock.calls.filter(([name]) => name === "beforeunload")).toHaveLength(1);
  const exit = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(exit);
  expect(exit.defaultPrevented).toBe(true);
  write.mockRestore(); restored.retryLocal();
  expect(state.recovery.hasUnpersisted()).toBe(false);
  const safeExit = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(safeExit);
  expect(safeExit.defaultPrevented).toBe(false);
  restored.discard();
  expect(state.recovery.memory()).toEqual([]);
});

it("reports malformed recovery and preserves the raw data for download", () => {
  const state = setup();
  const key = `bb-studio-pages:title:${JSON.stringify([origin, "page_one"])}:broken`;
  localStorage.setItem(key, '{"title":"A title in damaged recovery"');
  const controller = state.mount();
  expect(controller.snapshot.localError).toContain("Could not read");
  expect(state.recovery.exportRecords().records[key]).toContain("A title in damaged recovery");
  controller.edit("New title"); expect(controller.snapshot.localError).toContain("Could not read");
  expect(localStorage.getItem(key)).toContain("A title in damaged recovery");
});

it("retains a deleted page's title and does not recreate the page", async () => {
  const state = setup(); const controller = state.mount(); controller.edit("Keep this title"); state.remove(); await flush();
  expect(controller.snapshot.status).toBe("failed");
  expect(controller.snapshot.error).toContain("no longer exists");
  expect(state.recovery.load()[0]?.title).toBe("Keep this title");
});

it("does not let stale metadata or a discard overwrite newer server state", async () => {
  const state = setup(); const controller = state.mount(); controller.edit("Mine");
  controller.observe({ title: "New server title", updatedAt: 10 });
  controller.observe({ title: "Stale", updatedAt: 2 });
  expect(controller.snapshot.title).toBe("Mine"); controller.discard(); await flush();
  expect(controller.snapshot.title).toBe("New server title"); expect(state.transport.update).not.toHaveBeenCalled();
});
