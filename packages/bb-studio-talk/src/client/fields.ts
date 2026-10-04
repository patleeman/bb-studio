// Dictation fields: text surfaces in other plugins that Talk dictates into.
// The contract is plain DOM, so a plugin needs no code from Talk:
//
// - Mark the surface with `data-talk-field="<key>"` and a
//   `data-talk-field-label` such as `“Launch plan”`. The key must stay the
//   same across reloads, for example `pages:pg_123`.
// - Dispatch a bubbling `bb-talk:toggle` event from inside the field to
//   start dictating into it, or to finish that dictation.
// - Talk delivers the transcript as a cancelable `bb-talk:insert` event
//   (detail `{ text }`) on the field. Insert the text and call
//   preventDefault(). Otherwise the text waits until the field is back on
//   screen.
// - For "Go back", Talk dispatches a cancelable `bb-talk:open-field`
//   (detail `{ field }`) on window. The owner shows that field and calls
//   preventDefault(). If no owner does, Talk copies the dictation instead.
// - While Talk runs, `<html data-bb-talk>` is "idle", "dictating" (into the
//   field named by `data-bb-talk-field`), or "busy", and
//   `data-bb-talk-phase` holds the capture phase. `bb-talk:state` fires on
//   window whenever they change.

export const FIELD_ATTR = "data-talk-field";
export const FIELD_LABEL_ATTR = "data-talk-field-label";
export const TOGGLE_EVENT = "bb-talk:toggle";
export const INSERT_EVENT = "bb-talk:insert";
export const OPEN_FIELD_EVENT = "bb-talk:open-field";
export const STATE_EVENT = "bb-talk:state";

/** Dictations waiting for a field share the thread store under this prefix. */
export const FIELD_PENDING_PREFIX = "field:";

export interface FieldRef {
  key: string;
  label: string;
}

export type TalkStatus = "idle" | "dictating" | "busy";

const MAX_KEY = 200;
const MAX_LABEL = 120;

/** Validates a field reference read from the DOM or storage. */
export function parseField(value: unknown): FieldRef | null {
  if (!value || typeof value !== "object") return null;
  const { key, label } = value as Record<string, unknown>;
  if (typeof key !== "string" || key.trim() === "" || key.length > MAX_KEY) return null;
  const name = typeof label === "string" && label.trim() !== "" ? label.trim().slice(0, MAX_LABEL) : "that field";
  return { key, label: name };
}

/** The field an event target or focused node sits in. */
export function fieldAt(node: EventTarget | null): { element: HTMLElement; field: FieldRef } | null {
  const start = node instanceof Element ? node : node instanceof Node ? node.parentElement : null;
  const element = start?.closest<HTMLElement>(`[${FIELD_ATTR}]`) ?? null;
  const field = element
    ? parseField({ key: element.getAttribute(FIELD_ATTR), label: element.getAttribute(FIELD_LABEL_ATTR) })
    : null;
  return element && field ? { element, field } : null;
}

export function findField(key: string): HTMLElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(`[${FIELD_ATTR}]`)) {
    if (element.getAttribute(FIELD_ATTR) === key && element.isConnected) return element;
  }
  return null;
}

/** Hands `text` to the field's owner. Returns false when nobody took it. */
export function insertIntoField(key: string, text: string): boolean {
  const element = findField(key);
  if (!element || text.trim() === "") return false;
  const event = new CustomEvent(INSERT_EVENT, { detail: { text }, cancelable: true });
  element.dispatchEvent(event);
  return event.defaultPrevented;
}

/** Asks the field's owner to show it. Returns false when no owner did. */
export function requestOpenField(key: string): boolean {
  const event = new CustomEvent(OPEN_FIELD_EVENT, { detail: { field: key }, cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

/** Mirrors Talk's state onto `<html>` for field owners. */
export function publishStatus(status: TalkStatus, field: string | null, phase: string): void {
  const root = document.documentElement;
  const next = { bbTalk: status, bbTalkField: field ?? "", bbTalkPhase: phase };
  if (
    root.dataset.bbTalk === next.bbTalk &&
    (root.dataset.bbTalkField ?? "") === next.bbTalkField &&
    root.dataset.bbTalkPhase === next.bbTalkPhase
  ) {
    return;
  }
  root.dataset.bbTalk = next.bbTalk;
  root.dataset.bbTalkPhase = next.bbTalkPhase;
  if (field) root.dataset.bbTalkField = field;
  else delete root.dataset.bbTalkField;
  window.dispatchEvent(new CustomEvent(STATE_EVENT));
}

export function clearStatus(): void {
  const root = document.documentElement;
  delete root.dataset.bbTalk;
  delete root.dataset.bbTalkField;
  delete root.dataset.bbTalkPhase;
  window.dispatchEvent(new CustomEvent(STATE_EVENT));
}
