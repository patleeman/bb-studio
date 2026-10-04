// Other plugins (Studio Sidebar) open a Space's items and threads beside a
// thread too, but only Studio can open its own panel tabs, and only from a
// component inside that thread's surface. So they ask by window event, which
// the thread's header component answers; or, when the thread isn't open yet,
// leave the request in session storage for it to pick up once it mounts.
// Studio Sidebar copies these names (its studio/openInSpace.ts).
import type { BbNavigate } from "@get-bb/plugin-sdk/app";
import { SPACE_ITEM_ACTION, newDraftId, openItemTab, openItemsTab, openStatusTab, openThreadTab } from "./tabs";

export const OPEN_IN_SPACE_EVENT = "bb-studio:open-in-space";
const PENDING_KEY = "bb-studio:open-in-space";

export type OpenInSpaceRequest =
  | { kind: "item"; path: string; title: string }
  | { kind: "thread"; threadId: string; title: string }
  | { kind: "new-item" }
  | { kind: "items" }
  | { kind: "status" };

export interface OpenInSpaceDetail { threadId: string; request: OpenInSpaceRequest }

function valid(value: unknown): value is OpenInSpaceDetail {
  if (!value || typeof value !== "object") return false;
  const { threadId, request } = value as Partial<OpenInSpaceDetail>;
  if (typeof threadId !== "string" || !request || typeof request !== "object") return false;
  switch (request.kind) {
    case "item": return typeof request.path === "string" && request.path.startsWith("/") && typeof request.title === "string";
    case "thread": return typeof request.threadId === "string" && typeof request.title === "string";
    case "new-item": case "items": case "status": return true;
    default: return false;
  }
}

export function performOpen(navigate: BbNavigate, request: OpenInSpaceRequest): void {
  switch (request.kind) {
    case "item": openItemTab(navigate, { href: request.path, title: request.title }); break;
    case "thread": openThreadTab(navigate, { id: request.threadId, title: request.title }); break;
    case "new-item": navigate.openThreadPanel({ actionId: SPACE_ITEM_ACTION, title: "New in Space", params: { draft: newDraftId() } }); break;
    case "items": openItemsTab(navigate); break;
    case "status": openStatusTab(navigate); break;
  }
}

/** Answers requests for `threadId`, now and any left before it mounted. Returns the cleanup. */
export function listenForOpens(threadId: string, navigate: BbNavigate): () => void {
  try {
    const pending: unknown = JSON.parse(globalThis.sessionStorage?.getItem(PENDING_KEY) ?? "null");
    if (valid(pending) && pending.threadId === threadId) {
      globalThis.sessionStorage?.removeItem(PENDING_KEY);
      performOpen(navigate, pending.request);
    }
  } catch { /* storage unavailable or malformed */ }
  const onOpen = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (!valid(detail) || detail.threadId !== threadId || event.defaultPrevented) return;
    event.preventDefault();
    performOpen(navigate, detail.request);
  };
  window.addEventListener(OPEN_IN_SPACE_EVENT, onOpen);
  return () => window.removeEventListener(OPEN_IN_SPACE_EVENT, onOpen);
}
