// What Studio hides of BB's stack above a thread's composer, thread by
// thread (the fork's slots.experimental_hideHostEntries `promptStackFor`,
// desktop 1.0.12):
// - "active-child-threads" where the strands box shows: its rows show the
//   workers, so BB's list of running children goes (a child waiting on the
//   user stays in BB's card with its question);
// - "thread-context" in a conversation strands run in, where Studio draws
//   BB's thread context row in the Info tab instead (ContextInfoSection).
// Plain BB threads, workers and finished conversations keep both.
import { useEffect, type ComponentType } from "react";
import { member } from "../../kit/app/host-sdk";

export type PromptStackEntry = "active-child-threads" | "thread-context";

const NONE: readonly PromptStackEntry[] = Object.freeze([]);
const byThread = new Map<string, Map<number, readonly PromptStackEntry[]>>();
const merged = new Map<string, readonly PromptStackEntry[]>();
const listeners = new Set<() => void>();
let nextInstance = 0;

const notify = () => { for (const listener of listeners) listener(); };

function update(threadId: string, instance: number, entries: readonly PromptStackEntry[] | null): void {
  const instances = byThread.get(threadId) ?? new Map<number, readonly PromptStackEntry[]>();
  if (entries?.length) instances.set(instance, entries); else instances.delete(instance);
  if (instances.size) byThread.set(threadId, instances); else byThread.delete(threadId);
  merged.delete(threadId);
  notify();
}

/** BB's source: the same array while nothing changed for the thread. */
export const promptStackSource = {
  get(threadId: string): readonly PromptStackEntry[] {
    const cached = merged.get(threadId);
    if (cached) return cached;
    const instances = byThread.get(threadId);
    const value = instances ? Object.freeze([...new Set([...instances.values()].flat())].sort()) : NONE;
    merged.set(threadId, value);
    return value;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};

/** Hides these parts above this thread's composer while the calling component is mounted. */
export function useHidePromptStack(threadId: string, entries: readonly PromptStackEntry[]): void {
  const key = [...entries].sort().join(",");
  useEffect(() => {
    const instance = nextInstance++;
    update(threadId, instance, key ? (key.split(",") as PromptStackEntry[]) : null);
    return () => update(threadId, instance, null);
  }, [threadId, key]);
}

/** Test hook. */
export function resetPromptStackForTests(): void { byThread.clear(); merged.clear(); listeners.clear(); }

export interface ContextInfoProps { threadId: string; projectId: string; environment: { id: string } | null }

interface PluginRuntime { __bbPluginRuntime?: { pluginSdkApp?: object } }

/** The fork's runtime component, or null on a BB without it. */
export function hostContextSegments(): ComponentType<ContextInfoProps> | null {
  const app = (globalThis as PluginRuntime).__bbPluginRuntime?.pluginSdkApp;
  const component = app ? member(app, "experimental_ThreadContextSegments") : undefined;
  return typeof component === "function" ? (component as ComponentType<ContextInfoProps>) : null;
}

