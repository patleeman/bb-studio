/**
 * Seam `list-quiet`. Adds `?listEvents=status` to the browser WebSocket URL so
 * the server skips coalesced `events-appended` wakeups for background threads
 * this window is not viewing. Status, titles, unread badges, and pending
 * interactions still arrive on their own events, and opening a thread still
 * receives its full `thread-detail` + `thread-timeline` stream.
 */
export function withListQuiet(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("listEvents", "status");
  return parsed.toString();
}
