// Every task card on screen reads its task through one batched store: a Studio
// signal (any task, to-do or Bot thread change, several a second while agents
// work) costs one tasks.getMany for all the cards instead of a tasks.get each,
// and a card re-renders only when its own task changed. A long conversation
// holds dozens of ::work and ::loop cards.
import { useRealtime, useRealtimeConnectionState } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { STUDIO_REALTIME_CHANNEL } from "../../kit/contract";
import { visiblePoll } from "../../kit/app/visible-poll";
import { errorMessage } from "../../kit/format";
import { useCall } from "../../ui/live";
import { TASKS_GET_MANY_MAX } from "../limits";
import type { TaskView } from "../rpc-contract";

export interface TaskViewState {
  data: TaskView | null;
  /** The task is gone. */
  missing: boolean;
  error: string | null;
  loading: boolean;
}

export type LoadTaskViews = (ids: string[]) => Promise<{ views: { id: string; view: TaskView | null }[] }>;

/** A burst of signals within this long is one read. */
export const SIGNAL_COALESCE_MS = 250;
/** A card mounted in the same moment as others joins their read. */
export const MOUNT_COALESCE_MS = 16;
/** Read again this often without signals, as the cards did before. */
export const TASK_VIEWS_POLL_MS = 120_000;

const LOADING: TaskViewState = { data: null, missing: false, error: null, loading: true };

interface Entry { state: TaskViewState; json: string | null; listeners: Set<() => void> }

export class TaskViews {
  private readonly entries = new Map<string, Entry>();
  private readonly wanted = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopPoll: (() => void) | null = null;
  private inflight = false;
  /** Every card hears each signal; the first one queues the read for all. */
  private signalled = false;
  load: LoadTaskViews | null = null;
  /** Reads sent, for tests and measurements. */
  reads = 0;

  subscribe(id: string, listener: () => void): () => void {
    let entry = this.entries.get(id);
    if (!entry) {
      entry = { state: LOADING, json: null, listeners: new Set() };
      this.entries.set(id, entry);
      this.want([id], MOUNT_COALESCE_MS);
    }
    entry.listeners.add(listener);
    this.stopPoll ??= visiblePoll(() => this.signal(), TASK_VIEWS_POLL_MS);
    return () => {
      const current = this.entries.get(id);
      if (!current) return;
      current.listeners.delete(listener);
      if (current.listeners.size) return;
      this.entries.delete(id);
      this.wanted.delete(id);
      if (this.entries.size) return;
      this.stopPoll?.();
      if (this.timer) clearTimeout(this.timer);
      this.stopPoll = null;
      this.timer = null;
    };
  }

  get(id: string): TaskViewState {
    return this.entries.get(id)?.state ?? LOADING;
  }

  /** Something in Studio changed: read every card's task again, once per burst. */
  signal(): void {
    if (this.signalled) return;
    this.signalled = true;
    this.want([...this.entries.keys()], SIGNAL_COALESCE_MS);
  }

  /** One card's task, now (after an action on it). */
  refresh(id: string): void {
    if (this.entries.has(id)) this.want([id], 0);
  }

  private want(ids: readonly string[], delay: number): void {
    for (const id of ids) this.wanted.add(id);
    if (this.timer || !this.wanted.size) return;
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, delay);
  }

  private async flush(): Promise<void> {
    this.signalled = false;
    if (this.inflight) return;
    if (!this.load) { this.want([], SIGNAL_COALESCE_MS); return; }
    const ids = [...this.wanted].filter((id) => this.entries.has(id));
    this.wanted.clear();
    if (!ids.length) return;
    this.inflight = true;
    const load = this.load;
    try {
      await Promise.all(chunks(ids, TASKS_GET_MANY_MAX).map(async (chunk) => {
        this.reads++;
        try {
          const { views } = await load(chunk);
          const byId = new Map(views.map((each) => [each.id, each.view]));
          for (const id of chunk) this.apply(id, byId.has(id) ? byId.get(id)! : null);
        } catch (error) {
          for (const id of chunk) this.fail(id, errorMessage(error));
        }
      }));
    } finally {
      this.inflight = false;
      // Signals that came in during the read are read now, after the usual pause.
      if (this.wanted.size) this.want([], SIGNAL_COALESCE_MS);
    }
  }

  private apply(id: string, view: TaskView | null): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const json = view ? JSON.stringify(view) : "null";
    // Unchanged: the same state object, so the card does not render again.
    if (json === entry.json && !entry.state.loading && entry.state.error === null) return;
    entry.json = json;
    this.set(entry, view ? { data: view, missing: false, error: null, loading: false } : { data: null, missing: true, error: null, loading: false });
  }

  private fail(id: string, message: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.json = null;
    this.set(entry, { ...entry.state, error: message, loading: false });
  }

  private set(entry: Entry, state: TaskViewState): void {
    entry.state = state;
    for (const listener of entry.listeners) listener();
  }
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const shared = new TaskViews();

/**
 * A task card's task, read with every other card's. A card that is not
 * `active` (far off screen) stays out of the reads and keeps what it last
 * showed.
 */
export function useTaskView(id: string, active = true): TaskViewState & { refresh(): void } {
  const call = useCall();
  useEffect(() => { shared.load = (ids) => call("tasks.getMany", { ids }); }, [call]);
  const subscribe = useCallback((listener: () => void) => (active ? shared.subscribe(id, listener) : () => {}), [id, active]);
  const last = useRef<{ id: string; state: TaskViewState } | null>(null);
  const held = last.current?.id === id ? last.current.state : LOADING;
  const state = useSyncExternalStore(subscribe, () => (active ? shared.get(id) : held), () => LOADING);
  last.current = { id, state };
  useRealtime(STUDIO_REALTIME_CHANNEL, () => shared.signal());
  // Signals are not replayed after a socket reconnect; read again then.
  const connection = useRealtimeConnectionState();
  const previous = useRef(connection);
  useEffect(() => {
    if (connection === "connected" && previous.current !== "connected") shared.signal();
    previous.current = connection;
  }, [connection]);
  const refresh = useCallback(() => shared.refresh(id), [id]);
  return { ...state, refresh };
}

/** How far past its scroll area's edges a card still counts as near: two screens. */
export const NEAR_MARGIN = "200% 0px";

function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

/**
 * Whether an element is within two screens of what its scroll area shows.
 * Near until measured, and always without IntersectionObserver.
 */
export function useNearScreen(): [(element: HTMLElement | null) => void, boolean] {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [near, setNear] = useState(true);
  useEffect(() => {
    if (!element || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries.at(-1);
      if (entry) setNear(entry.isIntersecting);
    }, { root: scrollParent(element), rootMargin: NEAR_MARGIN });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, near];
}
