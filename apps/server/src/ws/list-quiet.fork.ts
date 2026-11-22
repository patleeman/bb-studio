/**
 * Seam `list-quiet`. A client that opens the socket as `/ws?listEvents=status`
 * (BB Studio's phone app) gets the thread list's list-relevant changes but not
 * its coalesced "events-appended" for threads it does not subscribe to itself.
 * A running agent sends those up to twice a second, and on a phone they keep
 * the radio awake for nothing the list shows. Its own thread subscriptions
 * still get every event. Other clients are unchanged.
 */
const quietSockets = new WeakSet<object>();

/** Remembers the socket as quiet when the URL it opened asks for it. */
export function markListQuiet(socket: object, url: string | undefined): void {
  if (!url) {
    return;
  }
  let value: string | null;
  try {
    value = new URL(url, "http://localhost").searchParams.get("listEvents");
  } catch {
    return;
  }
  if (value === "status") {
    quietSockets.add(socket);
  }
}

export function isListQuiet(socket: object): boolean {
  return quietSockets.has(socket);
}
