import { floatPanelFor, threadLinkId, type FloatTarget } from "@bb-studio/kit/app";
import { moveCompanion, openTab, tabKey, type FloatState } from "./stack";

export const mainCompanionPath = (key: string): string => `/plugins/float/companions/${encodeURIComponent(key)}`;

/** Resolves a retained main outlet to its actual target instead of its host route. */
export function mainTarget(state: FloatState, path: string): FloatTarget | null {
  const root = "/plugins/float/companions/";
  if (path.startsWith(root)) {
    let key = path.slice(root.length).split(/[?#]/)[0]!;
    try { key = decodeURIComponent(key); } catch { return null; }
    return state.tabs.find(tab => tab.key === key && tab.placement === "main")?.target ?? null;
  }
  const threadId = threadLinkId(path);
  if (threadId) return { kind: "thread", threadId };
  return floatPanelFor(path.split(/[?#]/)[0]!) ? { kind: "path", path } : null;
}

/** Exchanges placements while both tabs keep their own identity, pins and history. */
export function swapCompanions(state: FloatState, key: string, main: FloatTarget): FloatState {
  const active = state.tabs.find(tab => tab.key === key);
  const mainKey = tabKey(main);
  if (!active || mainKey === key) return state;
  const place = active.placement === "workbench" ? "workbench" : "floating";
  const opened = openTab(state, main, { placement: place });
  return moveCompanion(moveCompanion(opened, mainKey, place), key, "main");
}
