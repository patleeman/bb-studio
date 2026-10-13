// A temp note's done actions, in its page's header: Send to thread, Keep as
// page, Discard. Shown only while the page is an open note.
import { BAR_BUTTON, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, ICON_BUTTON } from "@bb-studio/kit/app";
import { errorMessage } from "@bb-studio/kit/format";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Icon, Input, cn } from "@bb-studio/kit/ui";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import { toast } from "sonner";
import { SEND_INLINE_LIMIT } from "../../constants";
import type { NoteSendMode, NoteView, rpcContract } from "../../notes-contract";
import { usePageNote } from "./use-note";

/** What Send does by default for a note this long. */
export const defaultSendMode = (length: number): NoteSendMode => (length <= SEND_INLINE_LIMIT ? "content" : "summarize");

/** `bar` sits in a header with other tools; `row` is a strip of its own under a narrow panel's header. */
export function NoteActions({ pageId, layout = "bar", onDiscarded }: { pageId: string; layout?: "bar" | "row"; onDiscarded?(): void }) {
  const { note, setNote } = usePageNote(pageId);
  if (!note || note.state !== "open") return null;
  const actions = <OpenNoteActions note={note} row={layout === "row"} onChanged={setNote} onDiscarded={onDiscarded} />;
  if (layout === "bar") return actions;
  return <div className="flex h-10 shrink-0 items-center border-b border-border bg-state-hover/40 pr-2 pl-1">{actions}</div>;
}

function OpenNoteActions({ note, row, onChanged, onDiscarded }: { note: NoteView; row: boolean; onChanged(note: NoteView | null): void; onDiscarded?(): void }) {
  const rpc = useRpc<typeof rpcContract>();
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"keep" | "discard" | null>(null);
  const [title, setTitle] = useState(note.title);

  const run = async <T,>(action: () => Promise<T>, done: (result: T) => void) => {
    setBusy(true);
    try {
      done(await action());
      return true;
    } catch (error) {
      toast.error("Couldn't finish the note", { description: errorMessage(error) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const send = (mode: "auto" | NoteSendMode) =>
    void run(() => rpc.call("notes.send", { pageId: note.pageId, mode }), (result) => {
      onChanged(result.note);
      toast.success(result.sent === "content" ? "Sent the notes to the thread." : "Asked the thread to summarize the notes.");
    });

  return (
    <div className={cn("flex shrink-0 items-center gap-0.5", row && "min-w-0 flex-1 justify-end")} data-note-actions="">
      <span className={cn("shrink-0 rounded-full bg-state-active px-2 py-0.5 text-[11px] font-medium text-muted-foreground", row ? "mr-auto ml-2" : "mr-1 max-md:hidden")}>Temp note</span>
      <div className="flex items-center">
        <button type="button" className={cn(BAR_BUTTON, "text-foreground")} disabled={busy} title="Send to thread" aria-label="Send to thread" onClick={() => send("auto")}>
          <Icon name="ArrowUp" className="size-4" />
          <span>Send to thread</span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={cn(ICON_BUTTON, "w-5")} disabled={busy} aria-label="How to send" title="How to send">
              <Icon name="ChevronDown" className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuItem onSelect={() => send("content")}>
              <div className="min-w-0">
                <div>Send the notes as the message{defaultSendMode(note.length) === "content" ? " (default)" : ""}</div>
                <div className="text-xs text-muted-foreground">The page's Markdown, as your message.</div>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => send("summarize")}>
              <div className="min-w-0">
                <div>Send a link and ask for a summary{defaultSendMode(note.length) === "summarize" ? " (default)" : ""}</div>
                <div className="text-xs text-muted-foreground">"Summarize these notes" with a link to the page. The default over {SEND_INLINE_LIMIT.toLocaleString()} characters.</div>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <button type="button" className={BAR_BUTTON} disabled={busy} title="Keep as page" aria-label="Keep as page" onClick={() => { setTitle(note.title); setDialog("keep"); }}>
        <Icon name="Check" className="size-4" />
        <span>Keep</span>
      </button>
      <button type="button" className={ICON_BUTTON} disabled={busy} title="Discard" aria-label="Discard" onClick={() => setDialog("discard")}>
        <Icon name="Trash2" className="size-4" />
      </button>

      <Dialog open={dialog === "keep"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault();
              if (!title.trim()) return;
              void run(() => rpc.call("notes.keep", { pageId: note.pageId, title: title.trim() }), (result) => {
                onChanged(result.note);
                setDialog(null);
                toast.success("Kept as a page in Notes.");
              });
            }}
          >
            <DialogHeader>
              <DialogTitle>Keep as page</DialogTitle>
              <DialogDescription>It stays in Notes as an ordinary page, no longer a temp note on this thread.</DialogDescription>
            </DialogHeader>
            <Input autoFocus aria-label="Page title" value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} onFocus={(event) => event.target.select()} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
              <Button type="submit" disabled={busy || !title.trim()}>Keep page</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "discard"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Discard these notes?</DialogTitle>
            <DialogDescription>The page is deleted, with everything typed in it. This can't be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => void run(() => rpc.call("notes.discard", { pageId: note.pageId }), () => {
                setDialog(null);
                onChanged(null);
                onDiscarded?.();
              })}
            >
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
