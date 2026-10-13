// "Expand to page" in a thread's composer, and the "Notes in progress" chip
// above it. Registered by app.tsx with app.composer.customize.
import { errorMessage } from "@bb-studio/kit/format";
import { Icon } from "@bb-studio/kit/ui";
import { useComposer, useRpc, type PluginComposerApi } from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import { toast } from "sonner";
import type { rpcContract } from "../../notes-contract";
import { localTimeZone, shortNoteTitle, useOpenNote, useThreadNote } from "./use-note";

const ACTION_BUTTON =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4";

/** What the button says, from the thread's open note and the draft. */
export function expandLabel(hasNote: boolean, draftEmpty: boolean): string {
  if (!hasNote) return "Expand to page";
  return draftEmpty ? "Open notes in progress" : "Add to notes in progress";
}

/**
 * Moves the draft into the page: the page holds it once the call returns, so
 * the composer is cleared then. Text typed meanwhile stays; attachments stay
 * in the composer, since a page can't take them.
 */
export function clearMovedText(composer: Pick<PluginComposerApi, "replace">, moved: string): void {
  if (!moved.trim()) return;
  composer.replace((current) => (current.text === moved ? { text: "", mentions: [] } : current));
}

export function ExpandToPage() {
  const composer = useComposer();
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : null;
  return threadId ? <ExpandButton composer={composer} threadId={threadId} /> : null;
}

function ExpandButton({ composer, threadId }: { composer: PluginComposerApi; threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const { note, setNote } = useThreadNote(threadId);
  const { openNote, anchor } = useOpenNote();
  const [busy, setBusy] = useState(false);
  const label = expandLabel(!!note, composer.text.trim() === "");
  const run = async () => {
    setBusy(true);
    const text = composer.text;
    try {
      const result = await rpc.call("notes.create", { threadId, text, timeZone: localTimeZone() });
      clearMovedText(composer, text);
      setNote(result.note);
      openNote(result.note);
    } catch (error) {
      toast.error("Couldn't expand to a page", { description: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        data-notes-expand=""
        className={ACTION_BUTTON}
        disabled={busy || composer.isSubmitting}
        onClick={() => void run()}
      >
        <Icon name="Maximize2" className="size-4" />
      </button>
      {anchor}
    </>
  );
}

/** Above the composer of a thread with an open note: reopens it. */
export function NotesInProgress() {
  const composer = useComposer();
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : null;
  return threadId ? <NotesChip threadId={threadId} /> : null;
}

function NotesChip({ threadId }: { threadId: string }) {
  const { note } = useThreadNote(threadId);
  const { openNote, anchor } = useOpenNote();
  if (!note) return null;
  return (
    <div className="flex min-w-0 px-2 pt-1.5 pb-0.5" data-notes-in-progress="">
      <button
        type="button"
        title={`Open ${note.title}`}
        className="inline-flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-full border border-border bg-background px-2.5 text-xs text-foreground shadow-xs hover:bg-state-hover"
        onClick={() => openNote(note)}
      >
        <Icon name="FileText" className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 font-medium">Notes in progress</span>
        <span className="min-w-0 truncate text-muted-foreground">{shortNoteTitle(note.title)}</span>
      </button>
      {anchor}
    </div>
  );
}
