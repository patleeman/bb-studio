// The windows of this browser window. sessionStorage keeps them across a
// reload without one window's floats following you into another.
import { useSyncExternalStore } from "react";
import { EMPTY, parseState, type FloatState } from "./windows";

const KEY = "bb-studio-float:windows";

function read(): FloatState {
  try {
    return parseState(JSON.parse(sessionStorage.getItem(KEY) ?? "null"));
  } catch {
    return EMPTY;
  }
}

let state: FloatState = typeof sessionStorage === "undefined" ? EMPTY : read();
const listeners = new Set<() => void>();

export function update(change: (current: FloatState) => FloatState): void {
  const next = change(state);
  if (next === state) return;
  state = next;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private windows can refuse storage; the windows last until reload.
  }
  for (const listener of listeners) listener();
}

export const getFloat = (): FloatState => state;

export function useFloatState(): FloatState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getFloat,
    getFloat,
  );
}
