// A page's note, kept current.
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useState } from "react";
import { REALTIME_CHANNEL, type RealtimeEvent } from "../../constants";
import type { NoteView, rpcContract } from "../../notes-contract";

export type NotesRpc = ReturnType<typeof useRpc<typeof rpcContract>>;

/** undefined while loading, null when there's none. */
function useNote(key: string | null, read: (rpc: NotesRpc, key: string) => Promise<NoteView | null>, matches: (event: RealtimeEvent, note: NoteView | null | undefined, key: string) => boolean) {
  const rpc = useRpc<typeof rpcContract>();
  const [note, setNote] = useState<NoteView | null | undefined>(undefined);
  const request = useRef(0);
  const current = useRef(note);
  current.current = note;
  const refetch = useCallback(() => {
    const id = ++request.current;
    if (!key) return;
    read(rpc, key).then((next) => id === request.current && setNote(next), () => id === request.current && setNote(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpc, key]);
  useEffect(() => {
    setNote(undefined);
    refetch();
    return () => { request.current++; };
  }, [refetch]);
  useRealtime(REALTIME_CHANNEL, (payload) => {
    if (key && matches(payload as RealtimeEvent, current.current, key)) refetch();
  });
  return { note: key ? note : null, refetch, setNote };
}

const touches = (event: RealtimeEvent, note: NoteView | null | undefined) =>
  !!note && ((event.type === "deleted" && event.pageIds.includes(note.pageId)) || (event.type === "tree"));

/** The note this page is (open, sent or kept), or null for an ordinary page. */
export function usePageNote(pageId: string | null) {
  return useNote(
    pageId,
    async (rpc, id) => (await rpc.call("notes.forPage", { pageId: id })).note,
    (event, note, id) => (event.type === "note" && event.pageId === id) || touches(event, note),
  );
}
