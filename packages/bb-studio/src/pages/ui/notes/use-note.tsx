// A thread's open note, or a page's note, kept current; and opening one
// beside its thread. Light: the composer loads it on every thread.
import { useOpenTarget } from "@bb-studio/kit/app";
import { useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { REALTIME_CHANNEL, type RealtimeEvent } from "../../constants";
import type { NoteView, rpcContract } from "../../notes-contract";
import { PAGE_TAB } from "../PageCard";

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

/** The thread's open note. */
export function useThreadNote(threadId: string | null) {
  return useNote(
    threadId,
    async (rpc, id) => (await rpc.call("notes.forThread", { threadId: id })).note,
    (event, note, id) => (event.type === "note" && event.threadId === id) || touches(event, note),
  );
}

/** The note this page is (open, sent or kept), or null for an ordinary page. */
export function usePageNote(pageId: string | null) {
  return useNote(
    pageId,
    async (rpc, id) => (await rpc.call("notes.forPage", { pageId: id })).note,
    (event, note, id) => (event.type === "note" && event.pageId === id) || touches(event, note),
  );
}

/** Opens a note in its thread's side panel, beside the chat; a split where there's no side panel. Render `anchor` once. */
export function useOpenNote(): { openNote(note: NoteView): void; anchor: ReactNode } {
  const navigate = useBbNavigate();
  const { open, anchor } = useOpenTarget();
  const openNote = useCallback((note: NoteView) => {
    if (navigate.openThreadPanel({ actionId: PAGE_TAB, title: note.title, params: { pageId: note.pageId } })) return;
    open({ kind: "path", path: note.href, title: note.title }, "split");
  }, [navigate, open]);
  return { openNote, anchor };
}

/** The title without its "Notes · " prefix, for a chip that already says Notes. */
export const shortNoteTitle = (title: string) => title.replace(/^Notes · /, "") || title;

export const localTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
};
