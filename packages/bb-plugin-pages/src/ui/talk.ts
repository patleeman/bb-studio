// Dictation through the Talk plugin. Talk's contract is plain DOM (see
// bb-plugin-talk/src/client/fields.ts): the editor is marked as a dictation
// field, Talk hands transcripts back as a cancelable `bb-talk:insert` event,
// and Talk's state is mirrored onto `<html data-bb-talk…>`.

import { useSyncExternalStore } from "react";

export const TALK_FIELD_ATTR = "data-talk-field";
export const TALK_FIELD_LABEL_ATTR = "data-talk-field-label";
export const TALK_TOGGLE_EVENT = "bb-talk:toggle";
export const TALK_INSERT_EVENT = "bb-talk:insert";
export const TALK_OPEN_FIELD_EVENT = "bb-talk:open-field";
const TALK_STATE_EVENT = "bb-talk:state";

const FIELD_PREFIX = "pages:";

export function pageFieldKey(pageId: string): string {
  return `${FIELD_PREFIX}${pageId}`;
}

/** The page id behind a Pages field key, or null for another plugin's field. */
export function pageIdFromField(key: unknown): string | null {
  if (typeof key !== "string" || !key.startsWith(FIELD_PREFIX)) return null;
  const id = key.slice(FIELD_PREFIX.length);
  return /^pg_[a-f0-9]{12}$/.test(id) ? id : null;
}

export function pageFieldLabel(title: string): string {
  return `“${title.trim() || "Untitled"}”`;
}

export type TalkMode =
  /** Talk isn't installed or hasn't loaded. */
  | "unavailable"
  | "idle"
  /** Talk is recording or transcribing into this field. */
  | "here"
  /** Talk is busy with something else. */
  | "elsewhere";

export interface TalkView {
  mode: TalkMode;
  phase: string;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(TALK_STATE_EVENT, onChange);
  return () => window.removeEventListener(TALK_STATE_EVENT, onChange);
}

function snapshot(): string {
  const { bbTalk, bbTalkField, bbTalkPhase } = document.documentElement.dataset;
  return `${bbTalk ?? ""}\n${bbTalkField ?? ""}\n${bbTalkPhase ?? ""}`;
}

export function talkView(raw: string, fieldKey: string): TalkView {
  const [status = "", field = "", phase = ""] = raw.split("\n");
  if (status === "idle") return { mode: "idle", phase };
  if (status === "dictating") return { mode: field === fieldKey ? "here" : "elsewhere", phase };
  if (status === "busy") return { mode: "elsewhere", phase };
  return { mode: "unavailable", phase: "" };
}

export function useTalk(fieldKey: string): TalkView {
  return talkView(useSyncExternalStore(subscribe, snapshot, () => ""), fieldKey);
}

/** Asks Talk to start, or finish, dictating into the field. */
export function toggleTalk(fieldKey: string): boolean {
  const field = Array.from(document.querySelectorAll<HTMLElement>(`[${TALK_FIELD_ATTR}]`)).find(
    (element) => element.getAttribute(TALK_FIELD_ATTR) === fieldKey,
  );
  if (!field) return false;
  field.dispatchEvent(new CustomEvent(TALK_TOGGLE_EVENT, { bubbles: true }));
  return true;
}

/** Splits a transcript into the paragraphs it should become. */
export function dictationParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Text to insert after `before` so words don't run together. */
export function spacedAfter(before: string, text: string): string {
  return before !== "" && !/\s$/.test(before) ? ` ${text}` : text;
}
