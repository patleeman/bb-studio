import { useSyncExternalStore } from "react";
import { CENTER_ANCHOR, MAX_WORKERS, workerAnchor, workerSeed } from "./scene/contract";

export type WorkerState = "running" | "needs-you" | "failed" | "done";
export interface SceneSignals {
  botId: string | null;
  workers: readonly { threadId: string; status: WorkerState }[];
  conversations: readonly { threadId: string; running: boolean; needsYou: boolean }[];
}

export const NO_SIGNALS: SceneSignals = { botId: null, workers: [], conversations: [] };

let current: SceneSignals = NO_SIGNALS;
const listeners = new Set<() => void>();

function sameSignals(a: SceneSignals, b: SceneSignals): boolean {
  return a.botId === b.botId && JSON.stringify(a.workers) === JSON.stringify(b.workers) && JSON.stringify(a.conversations) === JSON.stringify(b.conversations);
}

export function publishSceneSignals(next: SceneSignals): void {
  if (sameSignals(current, next)) return;
  current = next;
  for (const listener of listeners) listener();
}

export function sceneSignals(): SceneSignals {
  return current;
}

export function subscribeSceneSignals(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useSceneSignals(): SceneSignals {
  return useSyncExternalStore(subscribeSceneSignals, sceneSignals, () => NO_SIGNALS);
}

export function workerSlots(workers: SceneSignals["workers"]): Map<string, number> {
  const slots = new Map<string, number>();
  for (const worker of workers) {
    if (worker.status !== "running" || slots.size >= MAX_WORKERS) continue;
    slots.set(worker.threadId, slots.size);
  }
  return slots;
}

export function needsYou(signals: SceneSignals): boolean {
  return signals.workers.some((worker) => worker.status === "needs-you") || signals.conversations.some((row) => row.needsYou);
}

export interface SceneEvent { kind: "finished" | "error"; threadId: string; x: number; y: number }

export function sceneEvents(previous: SceneSignals, next: SceneSignals): SceneEvent[] {
  if (!previous.botId || previous.botId !== next.botId) return [];
  const events: SceneEvent[] = [];
  const slots = workerSlots(previous.workers);
  const before = new Map(previous.workers.map((worker) => [worker.threadId, worker.status]));
  for (const worker of next.workers) {
    if (before.get(worker.threadId) !== "running" || worker.status === "running" || worker.status === "needs-you") continue;
    const slot = slots.get(worker.threadId);
    const anchor = slot === undefined ? CENTER_ANCHOR : workerAnchor(workerSeed(slot));
    events.push({ kind: worker.status === "failed" ? "error" : "finished", threadId: worker.threadId, ...anchor });
  }
  const running = new Set(previous.conversations.filter((row) => row.running).map((row) => row.threadId));
  for (const row of next.conversations) {
    if (running.has(row.threadId) && !row.running) events.push({ kind: "finished", threadId: row.threadId, ...CENTER_ANCHOR });
  }
  return events;
}

export function resetSceneSignals(): void {
  current = NO_SIGNALS;
  for (const listener of listeners) listener();
}
