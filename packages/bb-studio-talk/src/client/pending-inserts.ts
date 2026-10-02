// Dictations finished away from their thread. BB keeps each thread's unsent
// composer text on the device and restores it when the thread opens, and
// writing the server draft of an open composer replaces what is typed. So
// Talk holds the text here and types it into the thread's composer the next
// time that composer is on screen.

import { parseRecordingReference, type RecordingReference } from "./recording-reference";
export const PENDING_STORAGE_KEY = "bb-plugin-talk:pending-inserts";

export type PendingInsert = string | { text: string; recordings: RecordingReference[] };
export type PendingInserts = Record<string, PendingInsert>;

export const pendingText = (value: PendingInsert): string => typeof value === "string" ? value : value.text;
export const pendingRecordings = (value: PendingInsert): RecordingReference[] => typeof value === "string" ? [] : value.recordings;

/** Adds `text` for a thread, after anything already waiting there. */
export function addPending(pending: PendingInserts, threadId: string, text: string, recordings: readonly RecordingReference[] = []): PendingInserts {
  const previous = pending[threadId];
  const before = previous ? pendingText(previous).trim() : "";
  const combined = before ? `${before} ${text.trim()}` : text.trim();
  const sources = [...new Map([...(previous ? pendingRecordings(previous) : []), ...recordings].map((recording) => [recording.id, recording])).values()];
  return { ...pending, [threadId]: sources.length ? { text: combined, recordings: sources } : combined };
}

export function withoutPending(pending: PendingInserts, threadId: string): PendingInserts {
  const { [threadId]: _removed, ...rest } = pending;
  return rest;
}

export function parsePending(raw: string | null): PendingInserts {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const result: PendingInserts = {};
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === "string" && entry.trim()) result[key] = entry;
      else if (entry && typeof entry === "object" && typeof entry.text === "string" && entry.text.trim()) {
        const recordings = Array.isArray(entry.recordings) ? (entry.recordings as unknown[]).map(parseRecordingReference).filter((recording): recording is RecordingReference => recording !== null) : [];
        result[key] = recordings.length ? { text: entry.text, recordings } : entry.text;
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function readPending(): PendingInserts {
  try {
    return parsePending(localStorage.getItem(PENDING_STORAGE_KEY));
  } catch {
    return {};
  }
}

export function writePending(pending: PendingInserts): void {
  try {
    if (Object.keys(pending).length === 0) localStorage.removeItem(PENDING_STORAGE_KEY);
    else localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(pending));
  } catch {
    // Private mode: the dictation is still in Talk recordings.
  }
}

// Dictations for another plugin's field also record when they started
// waiting. If the owner never shows the field again, say because it was
// uninstalled, the text is dropped after a while; it's still in Talk
// recordings.

export const FIELD_TIMES_KEY = "bb-plugin-talk:pending-field-times";
export const FIELD_PENDING_TTL_MS = 3 * 24 * 60 * 60_000;

export type PendingTimes = Record<string, number>;

/**
 * Splits waiting field keys into those past the TTL and the times to keep.
 * A key without a time starts its wait now.
 */
export function staleFields(keys: string[], times: PendingTimes, now: number): { stale: string[]; times: PendingTimes } {
  const kept: PendingTimes = {};
  const stale: string[] = [];
  for (const key of keys) {
    const since = times[key];
    const at = typeof since === "number" && Number.isFinite(since) && since <= now ? since : now;
    if (now - at > FIELD_PENDING_TTL_MS) stale.push(key);
    else kept[key] = at;
  }
  return { stale, times: kept };
}

export function readTimes(): PendingTimes {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(FIELD_TIMES_KEY) ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === "number"));
  } catch {
    return {};
  }
}

export function writeTimes(times: PendingTimes): void {
  try {
    if (Object.keys(times).length === 0) localStorage.removeItem(FIELD_TIMES_KEY);
    else localStorage.setItem(FIELD_TIMES_KEY, JSON.stringify(times));
  } catch {
    // Private mode: nothing is waiting in storage either.
  }
}
