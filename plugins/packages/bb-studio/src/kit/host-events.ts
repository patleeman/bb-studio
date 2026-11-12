// BB's events for interrupted turns and host daemons, on a BB that has them
// (the BB Studio fork). With them Studio reacts when something happens and
// needs no timer to notice it; on a stock BB the timers stay.

type Listen = (event: string, handler: (payload: never) => void) => void;

export type TurnInterruptedReason = "manual-stop" | "host-removed" | "host-daemon-restarted" | "host-connection-lost" | "provider-turn-idle" | "provider";

export interface HostEventHandlers {
  turnInterrupted(threadId: string, reason: TurnInterruptedReason): void;
  hostConnected(hostId: string, restarted: boolean): void;
  hostDisconnected(hostId: string): void;
}

/** True when a turn was cut off by its machine, not by a person or the provider. */
export function cutOffByHost(reason: TurnInterruptedReason): boolean {
  return reason === "host-daemon-restarted" || reason === "host-connection-lost";
}

/**
 * Listens for the three events. Returns false, having registered nothing
 * that fires, on a BB that does not know them (its `events.on` refuses an
 * unknown name).
 */
export function listenForHostEvents(bb: { events: { on: unknown } }, handlers: HostEventHandlers): boolean {
  const on = (bb.events.on as Listen).bind(bb.events);
  try {
    on("experimental_turn.interrupted", ((payload: { thread: { id: string }; reason: TurnInterruptedReason }) => handlers.turnInterrupted(payload.thread.id, payload.reason)) as never);
    on("experimental_host.connected", ((payload: { host: { id: string }; restarted: boolean }) => handlers.hostConnected(payload.host.id, payload.restarted)) as never);
    on("experimental_host.disconnected", ((payload: { host: { id: string } }) => handlers.hostDisconnected(payload.host.id)) as never);
    return true;
  } catch {
    return false;
  }
}

/** One file an agent changed, as BB's `experimental_thread.fileChanged` reports it. */
export interface ThreadFileChange {
  itemId: string;
  /** As the agent's tool gave it: usually a full path. */
  path: string;
  kind: "add" | "update" | "delete";
  movePath?: string;
}

/**
 * Listens for the files an agent finished changing. Returns false on a BB
 * without the event (its `events.on` refuses an unknown name), where the
 * caller keeps reading the thread's events on a timer.
 */
export function listenForFileChanges(bb: { events: { on: unknown } }, handler: (threadId: string, changes: ThreadFileChange[]) => void): boolean {
  const on = (bb.events.on as Listen).bind(bb.events);
  try {
    on("experimental_thread.fileChanged", ((payload: { thread: { id: string }; changes?: ThreadFileChange[] }) => handler(payload.thread.id, Array.isArray(payload.changes) ? payload.changes : [])) as never);
    return true;
  } catch {
    return false;
  }
}
