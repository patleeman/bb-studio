// A page's title in the side-panel tab header, renamed in place. It saves
// through the same title controller as the full Pages view, so the save, its
// conflict check and the browser's draft recovery all behave the same.
import { useEffect, useRef, useState } from "react";
import { untitled } from "../../kit/format";
import type { PageMetaView } from "../contract";
import { TITLE_MAX_LENGTH } from "./page-title";
import { relativeTime, type Rpc } from "./shared";
import { usePageTitle } from "./use-page-title";

// The input and the button share a box, so switching between them doesn't move anything.
const TITLE_BOX = "block h-5 w-full min-w-0 truncate rounded-sm p-0 text-left text-sm leading-5 font-medium";

export function PanelTitle({ page, rpc }: { page: PageMetaView; rpc: Rpc }) {
  const titleSave = usePageTitle(page, rpc);
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  const editing = draft !== null;

  useEffect(() => {
    if (editing) { inputRef.current?.focus(); inputRef.current?.select(); }
    else if (refocus.current) { refocus.current = false; buttonRef.current?.focus(); }
  }, [editing]);

  const finish = (save: boolean, returnFocus: boolean) => {
    if (draft === null) return;
    const title = draft.trim();
    refocus.current = returnFocus;
    setDraft(null);
    // An empty or unchanged title keeps the current one.
    if (!save || !title || title === titleSave.title) return;
    titleSave.controller.edit(title);
    titleSave.controller.retry(); // Save now rather than after the typing pause.
  };

  return (
    <>
      {editing ? (
        <input
          ref={inputRef}
          aria-label="Page title"
          value={draft}
          maxLength={TITLE_MAX_LENGTH}
          className={`${TITLE_BOX} border-0 bg-transparent text-foreground outline-none ring-1 ring-ring`}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => finish(true, false)}
          onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); finish(true, true); }
            else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(false, true); }
          }}
        />
      ) : (
        <button
          ref={buttonRef}
          type="button"
          title="Rename page"
          aria-label={`Rename page: ${untitled(titleSave.title)}`}
          className={`${TITLE_BOX} cursor-text hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none`}
          onClick={() => setDraft(titleSave.title)}
        >
          {untitled(titleSave.title)}
        </button>
      )}
      <TitleStatus titleSave={titleSave} updatedAt={page.updatedAt} />
    </>
  );
}

function TitleStatus({ titleSave, updatedAt }: { titleSave: ReturnType<typeof usePageTitle>; updatedAt: number }) {
  const { status, controller } = titleSave;
  const problem = status === "failed" ? "Title not saved." : status === "conflict" ? "Title changed elsewhere." : status === "recovered" ? "Unsaved title draft." : null;
  if (!problem) return <EditedLine updatedAt={updatedAt} saving={status === "pending" || status === "saving"} />;
  return (
    <div role="status" className="flex items-center gap-1 truncate text-[11px] text-destructive">
      {problem}
      <button type="button" className="underline" onClick={status === "conflict" ? controller.useMine : controller.retry}>
        {status === "conflict" ? "Use mine" : "Retry"}
      </button>
    </div>
  );
}

function EditedLine({ updatedAt, saving }: { updatedAt: number; saving: boolean }) {
  return <div className="truncate text-[11px] text-muted-foreground">{saving ? "Saving title…" : `Edited ${relativeTime(updatedAt)}`}</div>;
}
