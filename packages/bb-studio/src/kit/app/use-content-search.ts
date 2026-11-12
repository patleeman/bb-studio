import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "../format";
import { requestGeneration } from "../ui/request-generation";

const EMPTY: ReadonlyMap<string, string | null> = new Map();
type Search = (query: string) => Promise<ReadonlyMap<string, string | null>>;

/** Results belong to one query. Failed or pending queries never borrow old matches. */
export function useContentSearch(query: string, search: Search | undefined, revision = 0) {
  const text = query.trim();
  const [requests] = useState(requestGeneration);
  const [retryKey, setRetryKey] = useState(0);
  const [state, setState] = useState({ query: "", matches: EMPTY, loading: false, error: null as string | null });
  useEffect(() => {
    const current = requests.begin();
    if (!text || !search) { setState({ query: text, matches: EMPTY, loading: false, error: null }); return; }
    setState({ query: text, matches: EMPTY, loading: true, error: null });
    const timer = setTimeout(() => {
      search(text).then(
        (matches) => { if (current()) setState({ query: text, matches, loading: false, error: null }); },
        (cause: unknown) => { if (current()) setState({ query: text, matches: EMPTY, loading: false, error: errorMessage(cause) }); },
      );
    }, 200);
    return () => { requests.invalidate(); clearTimeout(timer); };
  }, [text, search, revision, retryKey, requests]);
  const retry = useCallback(() => setRetryKey((key) => key + 1), []);
  return { matches: state.query === text ? state.matches : EMPTY, loading: !!text && !!search && (state.query !== text || state.loading), error: state.query === text ? state.error : null, retry };
}
