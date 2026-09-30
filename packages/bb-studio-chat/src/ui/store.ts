// The floating chat's state, shared by the overlay, the thread header's
// Float button and the commands. It lives per window: sessionStorage keeps
// it across reloads without one window's chat following you into another.
import { useSyncExternalStore } from "react";

/**
 * - `closed`: only the "Work with this…" bar, and only over a Studio item.
 * - `compose`: BB's new-thread composer.
 * - `thread`: the chat in a card.
 * - `minimized`: the chat's header alone.
 */
export type ChatMode = "closed" | "compose" | "thread" | "minimized";

export interface ChatState {
  threadId: string | null;
  mode: ChatMode;
}

const KEY = "bb-studio-chat:state";
const MODES: readonly ChatMode[] = ["closed", "compose", "thread", "minimized"];

function read(): ChatState {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Partial<ChatState> | null;
    const threadId = typeof saved?.threadId === "string" && saved.threadId ? saved.threadId : null;
    const mode = MODES.includes(saved?.mode as ChatMode) ? (saved!.mode as ChatMode) : "closed";
    // A thread mode with no thread would show an empty card.
    return { threadId, mode: !threadId && (mode === "thread" || mode === "minimized") ? "closed" : mode };
  } catch {
    return { threadId: null, mode: "closed" };
  }
}

let state: ChatState = typeof sessionStorage === "undefined" ? { threadId: null, mode: "closed" } : read();
const listeners = new Set<() => void>();

export function setChat(next: Partial<ChatState> | ((current: ChatState) => Partial<ChatState>)) {
  const patch = typeof next === "function" ? next(state) : next;
  const merged = { ...state, ...patch };
  if (merged.threadId === state.threadId && merged.mode === state.mode) return;
  state = merged;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private windows can refuse storage; the chat still works until reload.
  }
  for (const listener of listeners) listener();
}

export const getChat = () => state;

/** Shows `threadId` in the card, opened. */
export const floatThread = (threadId: string) => setChat({ threadId, mode: "thread" });

/** Mod+Shift+J: open the chat, or put it away. */
export function toggleChat() {
  setChat(({ threadId, mode }) => {
    if (mode === "thread" || mode === "compose") return { mode: threadId ? "minimized" : "closed" };
    return { mode: threadId ? "thread" : "compose" };
  });
}

export function useChat(): ChatState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getChat,
    getChat,
  );
}
