// @vitest-environment happy-dom
// useTaskView: a card far off screen leaves the batched reads and keeps what it showed.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { TaskView } from "../rpc-contract";

const calls = vi.hoisted(() => ({ ids: [] as string[][], listeners: new Set<() => void>(), title: "First" }));
vi.mock("@get-bb/plugin-sdk/app", async () => {
  const { useEffect } = await import("react");
  return {
    useRealtimeConnectionState: () => "connected",
    useRealtime: (_channel: string, handler: () => void) => { useEffect(() => { calls.listeners.add(handler); return () => { calls.listeners.delete(handler); }; }, [handler]); },
  };
});
vi.mock("../../ui/live", () => ({
  useCall: () => async (_method: string, input: { ids: string[] }) => {
    calls.ids.push(input.ids);
    return { views: input.ids.map((id) => ({ id, view: { task: { id, title: calls.title }, history: [], todo: false, threads: [] } as unknown as TaskView })) };
  },
}));
const { useTaskView } = await import("./task-views");

it("an inactive card is not read on signals and keeps its last task; active again, it reads", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  let shown: string | undefined;
  function Card({ active }: { active: boolean }) { shown = useTaskView("task_far", active).data?.task.title; return null; }
  const root = createRoot(document.createElement("div"));
  const signal = () => act(async () => { for (const listener of calls.listeners) listener(); await vi.advanceTimersByTimeAsync(300); });
  try {
    await act(async () => root.render(<Card active />));
    await act(async () => vi.advanceTimersByTimeAsync(20));
    expect(calls.ids).toEqual([["task_far"]]);
    expect(shown).toBe("First");
    await act(async () => root.render(<Card active={false} />));
    expect(shown).toBe("First");
    calls.title = "Second";
    await signal();
    expect(calls.ids).toHaveLength(1);
    expect(shown).toBe("First");
    await act(async () => root.render(<Card active />));
    await act(async () => vi.advanceTimersByTimeAsync(20));
    expect(calls.ids).toEqual([["task_far"], ["task_far"]]);
    expect(shown).toBe("Second");
  } finally { act(() => root.unmount()); vi.useRealTimers(); }
});
