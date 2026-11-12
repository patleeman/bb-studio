import type { LinkAction } from "./router";

const handlers = new Map<LinkAction, (() => boolean)[]>();

export function setLinkActionHandler(action: LinkAction, handler: () => boolean): () => void {
  handlers.set(action, [...(handlers.get(action) ?? []), handler]);
  return () => { handlers.set(action, (handlers.get(action) ?? []).filter((each) => each !== handler)); };
}

export function runLinkAction(action: LinkAction): boolean {
  const handler = handlers.get(action)?.at(-1);
  if (!handler) return false;
  try { return handler(); } catch { return false; }
}
