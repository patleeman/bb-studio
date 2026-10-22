// A page's metadata for a card or panel, without the editor: `::page` cards
// load it at startup, so it must not import BlockNote or Yjs.
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useState } from "react";
import { requestGeneration } from "../../kit/ui/request-generation";
import { REALTIME_CHANNEL, type RealtimeEvent } from "../constants";
import type { PageMetaView, rpcContract } from "../contract";

/** A page's metadata, kept current: undefined while loading, null once it's gone. */
export function usePanelPage(pageId: string | null): { page: PageMetaView | null | undefined; refetch(): void; markMissing(): void } {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<{ id: string | null; page: PageMetaView | null | undefined }>({ id: pageId, page: undefined });
  const setPage = useCallback((page: PageMetaView | null | undefined) => setState({ id: pageId, page }), [pageId]);
  const [requests] = useState(requestGeneration);
  const markMissing = useCallback(() => { requests.invalidate(); setPage(null); }, [requests, setPage]);
  const fetchPage = useCallback(() => {
    const current = requests.begin();
    if (!pageId) return;
    rpc.call("pages.get", { id: pageId }).then(
      (result) => current() && setPage(result.page?.id === pageId ? result.page : null),
      () => current() && setPage(null),
    );
  }, [rpc, pageId, requests, setPage]);
  useEffect(() => {
    setPage(undefined);
    fetchPage();
    return () => { requests.invalidate(); };
  }, [fetchPage, requests, setPage]);
  useRealtime(REALTIME_CHANNEL, (payload) => {
    const event = payload as RealtimeEvent;
    if (!pageId) return;
    if ((event.type === "page" && event.pageId === pageId) || event.type === "tree") fetchPage();
    if (event.type === "deleted" && event.pageIds.includes(pageId)) markMissing();
  });
  return { page: pageId ? (state.id === pageId ? state.page : undefined) : null, refetch: fetchPage, markMissing };
}
