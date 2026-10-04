// Where an Inbox entry opens. Entries written before the work model can point
// at office panels that are gone (/plugins/studio/office, office-team/<bot>,
// office-conversation/<id>); those open the entry's thread instead, or nothing.
import type { InboxEvent } from "./model";

export type InboxLink = { kind: "path"; path: string } | { kind: "thread"; threadId: string } | null;

const LIVE_OFFICE = new Set(["office-inbox"]);

export function isRemovedPath(path: string): boolean {
  const match = /^\/plugins\/studio\/(office[^/?#]*)/.exec(path);
  return match !== null && !LIVE_OFFICE.has(match[1]!);
}

export function inboxLink(event: Pick<InboxEvent, "href" | "item" | "threadId">): InboxLink {
  const path = event.href ?? event.item?.href ?? null;
  if (path && !isRemovedPath(path)) return { kind: "path", path };
  return event.threadId ? { kind: "thread", threadId: event.threadId } : null;
}
