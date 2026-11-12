import type { CardClick } from "./open";
import type { LinkOutcome, OpenLinkOptions } from "./router";

export interface ElementLinkEvent { preventDefault(): void; detail: { nativeEvent: CardClick } }

export function openWhiteboardLink(element: { link?: string | null }, event: ElementLinkEvent, threadId: string | null | undefined, open: (link: string, options: OpenLinkOptions) => Promise<LinkOutcome>): boolean {
  if (!element.link) return false;
  event.preventDefault();
  const { nativeEvent } = event.detail;
  void open(element.link, { source: "whiteboard", modifiers: { meta: Boolean(nativeEvent.metaKey), ctrl: Boolean(nativeEvent.ctrlKey), shift: Boolean(nativeEvent.shiftKey) }, ...(threadId ? { threadId } : {}) });
  return true;
}
