import { MAX_TOPIC } from "./shared";

export const READER_STATE_KEY = "bb-studio.feed.reader.v1";
export const READER_PAGE = 40;
export const MAX_RESTORE_POSTS = 2_000;
export interface ReaderFilters { query: string; unread: boolean; from: string; through: string; topic: string | null }
export interface ReaderPosition { postId: string | null; offset: number; scrollTop: number }
export interface ReaderState { filters: ReaderFilters; open: string | null; count: number; position: ReaderPosition | null }
export const emptyFilters = (): ReaderFilters => ({ query: "", unread: false, from: "", through: "", topic: null });
export const emptyReaderState = (): ReaderState => ({ filters: emptyFilters(), open: null, count: READER_PAGE, position: null });

/** Date inputs describe local calendar days, including DST changes. */
export function localDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (year! < 1000 || year! > 9999) return null;
  const date = new Date(year!, month! - 1, day!);
  return date.getFullYear() === year && date.getMonth() === month! - 1 && date.getDate() === day ? date : null;
}

export function filterError(filters: ReaderFilters): string | null {
  if ((filters.from && !localDay(filters.from)) || (filters.through && !localDay(filters.through))) return "Choose valid dates.";
  if (filters.from && filters.through && filters.from > filters.through) return "From must be on or before Through.";
  return null;
}

export function filterInput(filters: ReaderFilters) {
  const start = localDay(filters.from);
  const end = localDay(filters.through);
  if (end) end.setDate(end.getDate() + 1);
  return {
    topic: filters.topic,
    ...(filters.query.trim() ? { query: filters.query.trim() } : {}),
    ...(filters.unread ? { unread: true } : {}),
    ...(start ? { since: start.getTime() - 1 } : {}),
    ...(end ? { until: end.getTime() - 1 } : {}),
  };
}

/** Stored browser state is optional and untrusted; never restore post content. */
export function parseReaderState(raw: string | null): ReaderState {
  const fallback = emptyReaderState();
  try {
    const value = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object" || !value.filters) return fallback;
    const f = value.filters;
    const filters: ReaderFilters = {
      query: typeof f.query === "string" ? f.query.slice(0, 200) : "",
      unread: f.unread === true,
      from: typeof f.from === "string" && localDay(f.from) ? f.from : "",
      through: typeof f.through === "string" && localDay(f.through) ? f.through : "",
      topic: typeof f.topic === "string" ? f.topic.slice(0, MAX_TOPIC) : null,
    };
    if (filterError(filters)) { filters.from = ""; filters.through = ""; }
    const id = (input: unknown) => typeof input === "string" && input.length <= 100 ? input : null;
    const finite = (input: unknown, low: number, high: number) => typeof input === "number" && Number.isFinite(input) ? Math.min(high, Math.max(low, input)) : 0;
    return {
      filters,
      open: id(value.open),
      count: Math.max(READER_PAGE, Math.floor(finite(value.count, READER_PAGE, MAX_RESTORE_POSTS))),
      position: value.position && typeof value.position === "object" ? {
        postId: id(value.position.postId), offset: finite(value.position.offset, -100_000, 100_000), scrollTop: finite(value.position.scrollTop, 0, 10_000_000),
      } : null,
    };
  } catch { return fallback; }
}

export function readReaderState(): ReaderState {
  try { return parseReaderState(sessionStorage.getItem(READER_STATE_KEY)); } catch { return emptyReaderState(); }
}

export function writeReaderState(state: ReaderState): void {
  try { sessionStorage.setItem(READER_STATE_KEY, JSON.stringify({ ...state, count: Math.min(state.count, MAX_RESTORE_POSTS) })); } catch { /* Private browsing and storage limits must not block reading. */ }
}
