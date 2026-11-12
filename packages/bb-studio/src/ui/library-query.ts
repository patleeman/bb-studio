// The new tab page's library query, stored for the next visit: the sidebar
// shows it selected, and the tab strip's New reads its Project filter.
import { useEffect, useState } from "react";

export const QUERY_KEY = "studio:query:all";
export const QUERY_EVENT = "studio:query";
/** The list changed its own query; the sidebar follows. */
export const QUERY_CHANGED = "studio:query-changed";

/** The library's query text as stored; "" when storage is refused. */
export function readLibraryQuery(): string {
  try { return localStorage.getItem(QUERY_KEY) ?? ""; } catch { return ""; }
}

/** The library's current query text, as the Studio sidebar shows it selected. */
export function useLibraryQuery(): string {
  const [query, setQuery] = useState(readLibraryQuery);
  useEffect(() => {
    const onQuery = (event: Event) => setQuery((event as CustomEvent<string>).detail);
    window.addEventListener(QUERY_EVENT, onQuery);
    window.addEventListener(QUERY_CHANGED, onQuery);
    return () => { window.removeEventListener(QUERY_EVENT, onQuery); window.removeEventListener(QUERY_CHANGED, onQuery); };
  }, []);
  return query;
}
