// The batched task-card store: one read for every card, a card re-renders only when its task changed.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TaskView } from "../rpc-contract";
import { MOUNT_COALESCE_MS, SIGNAL_COALESCE_MS, TaskViews } from "./task-views";

const view = (id: string, title = "A task") => ({ task: { id, title }, history: [], todo: false, threads: [] }) as unknown as TaskView;
let tasks: Record<string, TaskView | null>;
let store: TaskViews;
const load = vi.fn(async (ids: string[]) => ({ views: ids.map((id) => ({ id, view: tasks[id] ?? null })) }));
const settle = async (ms: number) => { await vi.advanceTimersByTimeAsync(ms); };

beforeEach(() => {
  vi.useFakeTimers();
  tasks = { a: view("a"), b: view("b"), c: view("c") };
  load.mockClear();
  store = new TaskViews();
  store.load = load;
});
afterEach(() => { vi.useRealTimers(); });

it("reads the cards mounted together in one call", async () => {
  for (const id of ["a", "b", "c"]) store.subscribe(id, () => {});
  await settle(MOUNT_COALESCE_MS);
  expect(load).toHaveBeenCalledTimes(1);
  expect(load.mock.calls[0]![0]).toEqual(["a", "b", "c"]);
  expect(store.get("b").data?.task.id).toBe("b");
  expect(store.get("b").loading).toBe(false);
});

it("a burst of signals heard by every card is one read, and only a changed card re-renders", async () => {
  const heard = { a: 0, b: 0, c: 0 };
  for (const id of ["a", "b", "c"] as const) store.subscribe(id, () => { heard[id]++; });
  await settle(MOUNT_COALESCE_MS);
  expect(heard).toEqual({ a: 1, b: 1, c: 1 });
  const before = store.get("a");
  tasks.b = view("b", "Renamed");
  for (let i = 0; i < 10; i++) { store.signal(); store.signal(); store.signal(); }
  await settle(SIGNAL_COALESCE_MS);
  expect(load).toHaveBeenCalledTimes(2);
  expect(heard).toEqual({ a: 1, b: 2, c: 1 });
  expect(store.get("a")).toBe(before);
  expect(store.get("b").data?.task.title).toBe("Renamed");
});

it("signals during a read are read once after it", async () => {
  let release!: () => void;
  store.subscribe("a", () => {});
  await settle(MOUNT_COALESCE_MS);
  load.mockImplementationOnce(async (ids) => { await new Promise<void>((resolve) => { release = resolve; }); return { views: ids.map((id) => ({ id, view: tasks[id] ?? null })) }; });
  store.signal();
  await settle(SIGNAL_COALESCE_MS);
  expect(load).toHaveBeenCalledTimes(2);
  store.signal(); store.signal();
  await settle(SIGNAL_COALESCE_MS);
  expect(load).toHaveBeenCalledTimes(2);
  release();
  await settle(SIGNAL_COALESCE_MS);
  expect(load).toHaveBeenCalledTimes(3);
});

it("says a task is gone, and keeps the last task on a failed read", async () => {
  tasks.c = null;
  store.subscribe("a", () => {});
  store.subscribe("c", () => {});
  await settle(MOUNT_COALESCE_MS);
  expect(store.get("c")).toMatchObject({ missing: true, data: null, loading: false });
  load.mockRejectedValueOnce(new Error("Tasks could not be loaded."));
  store.signal();
  await settle(SIGNAL_COALESCE_MS);
  expect(store.get("a")).toMatchObject({ error: "Tasks could not be loaded.", loading: false });
  expect(store.get("a").data?.task.id).toBe("a");
  store.signal();
  await settle(SIGNAL_COALESCE_MS);
  expect(store.get("a").error).toBeNull();
});

it("refresh reads one card at once, and the last card leaving stops the reads", async () => {
  const stop = store.subscribe("a", () => {});
  store.subscribe("b", () => {})();
  await settle(MOUNT_COALESCE_MS);
  expect(load.mock.calls[0]![0]).toEqual(["a"]);
  store.refresh("a");
  await settle(0);
  expect(load).toHaveBeenCalledTimes(2);
  stop();
  store.signal();
  await settle(200_000);
  expect(load).toHaveBeenCalledTimes(2);
});
