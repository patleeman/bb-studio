// The quick card's state, one per window: whether it's open, which summon
// this is (each summon starts a fresh chat), and the chat it shows. The
// "Visual Chat: Ask" command toggles it; the card (in the prebuilt bundle)
// reads it through props, so it holds no state of its own between summons.
// Closing never loses anything: the chat is an ordinary canvas, in the list.
import { canvasHref, canvasNewHref, type CanvasMeta } from "../shared";

export interface QuickState {
  open: boolean;
  /** Counts summons: the card is keyed by it, so each one starts fresh. */
  session: number;
  /** The chat the card shows; null: a new one, made by its first message. */
  threadId: string | null;
}

export interface QuickStore {
  get(): QuickState;
  subscribe(listener: () => void): () => void;
  /** Opens a fresh chat (a no-op while open). */
  open(): void;
  /** Closes; focus goes back where it was before the card opened unless `restoreFocus` is false. */
  close(options?: { restoreFocus?: boolean }): void;
  toggle(): void;
  /** The chat the card follows: the one its first message made, or another it stepped to. */
  setThread(threadId: string | null): void;
  /** Opens the card's chat in the full page and closes the card. Returns the path. */
  expand(navigate: (path: string) => void): string;
}

/** The full page for a chat: the chat itself, or a new one when nothing was sent yet. */
export const expandHref = (threadId: string | null) => (threadId ? canvasHref(threadId) : canvasNewHref());

/**
 * `expandTo`: where the full page is not an address in BB's main view (it is a window of its own,
 * src/window-app.tsx), what opens a chat there; `expand` then calls it and leaves `navigate` alone.
 */
export function createQuickStore({ expandTo }: { expandTo?: (threadId: string | null) => void } = {}): QuickStore {
  let state: QuickState = { open: false, session: 0, threadId: null };
  let returnTo: HTMLElement | null = null;
  const listeners = new Set<() => void>();
  const set = (next: QuickState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const store: QuickStore = {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    open() {
      if (state.open) return;
      const active = typeof document !== "undefined" ? document.activeElement : null;
      returnTo = active && active !== document.body && typeof (active as HTMLElement).focus === "function" ? (active as HTMLElement) : null;
      set({ open: true, session: state.session + 1, threadId: null });
    },
    close({ restoreFocus = true } = {}) {
      if (!state.open) return;
      const target = returnTo;
      returnTo = null;
      set({ ...state, open: false });
      // After the card has unmounted, so its own focus handling is done.
      if (restoreFocus && target) setTimeout(() => { if (target.isConnected) target.focus({ preventScroll: true }); }, 0);
    },
    toggle() {
      if (state.open) store.close();
      else store.open();
    },
    setThread(threadId) {
      if (state.threadId !== threadId) set({ ...state, threadId });
    },
    expand(navigate) {
      const path = expandHref(state.threadId);
      const threadId = state.threadId;
      store.close({ restoreFocus: false });
      if (expandTo) expandTo(threadId);
      else navigate(path);
      return path;
    },
  };
  return store;
}

/** The chats around this one, newest first: `older` is a step back, `newer` a step forward ("new": a new chat). */
export function neighborChats(list: readonly Pick<CanvasMeta, "threadId" | "title" | "updatedAt">[], threadId: string | null) {
  const sorted = [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  if (threadId === null) return { older: sorted[0] ?? null, newer: null };
  const at = sorted.findIndex((each) => each.threadId === threadId);
  // Not listed yet (just made): it's the newest.
  if (at < 0) return { older: sorted[0] ?? null, newer: "new" as const };
  return { older: sorted[at + 1] ?? null, newer: at === 0 ? ("new" as const) : sorted[at - 1]! };
}
