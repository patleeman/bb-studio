// A page's metadata for a card or panel, without the editor: `::page` cards
// load it at startup, so it must not import BlockNote or Yjs.
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useState } from "react";
import { REALTIME_CHANNEL, type RealtimeEvent } from "../constants";
import type { PageMetaView, rpcContract } from "../contract";

/** A page's metadata, kept current: undefined while loading, null once it's gone. */
export function usePanelPage(pageId: string | null): { page: PageMetaView | null | undefined; refetch(): void } {
  const rpc = useRpc<typeof rpcContract>();
  const [page, setPage] = useState<PageMetaView | null | undefined>(undefined);
  const pageRequest = useRef(0);
  const fetchPage = useCallback(() => {
    const request = ++pageRequest.current;
    if (!pageId) return;
    rpc.call("pages.get", { id: pageId }).then(
      (result) => request === pageRequest.current && setPage(result.page?.id === pageId ? result.page : null),
      () => request === pageRequest.current && setPage(null),
    );
  }, [rpc, pageId]);
  useEffect(() => {
    setPage(undefined);
    fetchPage();
    return () => { pageRequest.current++; };
  }, [fetchPage]);
  useRealtime(REALTIME_CHANNEL, (payload) => {
    const event = payload as RealtimeEvent;
    if (!pageId) return;
    if ((event.type === "page" && event.pageId === pageId) || event.type === "tree") fetchPage();
    if (event.type === "deleted" && event.pageIds.includes(pageId)) { pageRequest.current++; setPage(null); }
  });
  return { page: pageId ? page : null, refetch: fetchPage };
}
