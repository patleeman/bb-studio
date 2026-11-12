// One layout for a page wherever it opens: the Pages view and a thread's side
// panel share the reading column, the icon and the big title, so they can't
// drift apart. The body text sits in the editor's own padding (styles.css,
// `.pages-main > .bn-editor`), which lines up with PAGE_GUTTER.
import { useCallback, useEffect, useRef } from "react";
import { untitled } from "../../kit/format";
import { ITEM_TITLE } from "../../kit/app/index";
import { cn, Icon } from "../../kit/ui/index";
import type { PageMetaView } from "../contract";
import { TITLE_MAX_LENGTH } from "./page-title";
import { PageIconPicker } from "./PageIconPicker";
import type { Rpc } from "./shared";
import type { usePageTitle } from "./use-page-title";

/** The centred reading column. Narrower containers fill it, left-aligned. */
export const PAGE_COLUMN = "pages-column mx-auto w-full max-w-[828px] pt-12 pb-40 max-md:pt-6";
/** Side padding matching the editor's, so the title lines up with the text. */
export const PAGE_GUTTER = "pages-gutter px-[54px] max-md:px-4";

export function PageColumn({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn(PAGE_COLUMN, className)} data-page-column="">{children}</div>;
}

/** The editor below the heading, or why it isn't there yet. */
export function PageBody({ missing, children }: { missing: boolean; children: React.ReactNode }) {
  return (
    <div className="mt-5 flex">
      {children ?? <p className={cn(PAGE_GUTTER, "text-sm text-muted-foreground")}>{missing ? "This page no longer exists." : "Connecting…"}</p>}
    </div>
  );
}

type TitleSave = ReturnType<typeof usePageTitle>;

/** The page's icon and big title, renamed in place, with its save problems below it. */
export function PageHeading({ page, rpc, titleSave }: { page: PageMetaView; rpc: Rpc; titleSave: TitleSave }) {
  const { title } = titleSave;
  return (
    <div className={cn("group/title", PAGE_GUTTER)} data-page-heading="">
      {page.icon ? (
        <PageIconPicker page={page} rpc={rpc}>
          <button type="button" aria-label="Change icon" className="mb-3 rounded-md text-[44px] leading-none hover:bg-state-hover">
            {page.icon}
          </button>
        </PageIconPicker>
      ) : null}
      <div className="relative">
        {!page.icon ? (
          <PageIconPicker page={page} rpc={rpc}>
            <button
              type="button"
              aria-label="Add icon"
              title="Add icon"
              className="pages-reveal absolute top-2.5 -left-9 flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover/title:opacity-100 hover:bg-state-hover hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100 max-md:static max-md:mb-1 max-md:-ml-1.5"
            >
              <Smiley className="size-[18px]" />
            </button>
          </PageIconPicker>
        ) : null}
        <TitleField
          value={title}
          maxLength={TITLE_MAX_LENGTH}
          // A new page starts with its title, like a new document.
          autoFocus={!page.title && !page.archived}
          onChange={(event) => titleSave.controller.edit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              (event.currentTarget.closest(".pages-doc")?.querySelector(".pages-editor .bn-editor") as HTMLElement | null)?.focus();
            }
          }}
        />
      </div>
      {titleSave.status === "failed" || titleSave.status === "conflict" || titleSave.status === "recovered" || titleSave.localError || titleSave.alternatives.length ? (
        <div className="mt-3 rounded-md border border-border px-3 py-2 text-sm">
          <p role="status" aria-live="polite" className={cn(titleSave.status === "failed" || titleSave.status === "conflict" || titleSave.localError ? "text-destructive" : "text-muted-foreground")}>
            {titleSave.status === "conflict" ? "The title changed in BB. Your title draft is kept here."
              : titleSave.status === "failed" ? "Title save failed."
              : titleSave.status === "recovered" ? "Recovered an unsaved title draft."
              : titleSave.status === "saved" ? "Title saved to BB."
              : "Saving title to BB…"}
            {titleSave.localError ? " Local title recovery failed. Keep this page open or download the draft."
              : titleSave.status !== "saved" ? " Title draft saved on this browser." : ""}
          </p>
          {titleSave.error ? <p className="mt-1 break-words text-muted-foreground">{titleSave.error}</p> : null}
          {titleSave.status === "conflict" ? <p className="mt-1 break-words">Current title in BB: {untitled(titleSave.currentTitle)}</p> : null}
          <div className="flex flex-wrap gap-1">
            {titleSave.localError ? (
              <button type="button" className="min-h-11 rounded-md px-2 underline focus-visible:ring-2 focus-visible:ring-ring" onClick={titleSave.controller.retryLocal}>Retry local title recovery</button>
            ) : null}
            {["failed", "recovered", "conflict"].includes(titleSave.status) ? (
              <button type="button" className="min-h-11 rounded-md px-2 underline focus-visible:ring-2 focus-visible:ring-ring" onClick={titleSave.controller.retry}>Retry title save</button>
            ) : null}
            {titleSave.status === "conflict" ? (
              <button type="button" className="min-h-11 rounded-md px-2 underline focus-visible:ring-2 focus-visible:ring-ring" onClick={titleSave.controller.useMine}>Use my title</button>
            ) : null}
            {titleSave.status !== "saved" || titleSave.localError ? (
              <>
                <button type="button" className="min-h-11 rounded-md px-2 underline focus-visible:ring-2 focus-visible:ring-ring" onClick={titleSave.controller.export}>Download title draft</button>
                {titleSave.status !== "saved" ? <button type="button" disabled={titleSave.status === "saving"} className="min-h-11 rounded-md px-2 underline focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" onClick={titleSave.controller.discard}>Discard title draft</button> : null}
              </>
            ) : null}
            {titleSave.alternatives.map(draft => (
              <button key={draft.id} type="button" disabled={titleSave.status === "saving"} className="min-h-11 max-w-full rounded-md px-2 text-left underline focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" onClick={() => titleSave.controller.choose(draft.id)}>Recover other title: {untitled(draft.title)}</button>
            ))}
          </div>
        </div>
      ) : null}
      {page.archived ? (
        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="Archive" className="size-3.5" /> Archived
          <button
            type="button"
            className="underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => void rpc.call("pages.update", { id: page.id, archived: false })}
          >
            Restore
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** A title that wraps onto more lines instead of scrolling sideways. */
function TitleField(props: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "className" | "rows">) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = useCallback(() => {
    const field = ref.current;
    // A background workspace tab has no layout. Measuring it would collapse
    // the title to zero until another window resize.
    if (!field || !field.getClientRects().length) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }, []);
  useEffect(fit, [fit, props.value]);
  useEffect(() => {
    window.addEventListener("resize", fit);
    let width = -1;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(entries => {
      const next = entries[0]?.contentRect.width ?? 0;
      if (next === width) return;
      width = next;
      fit();
    });
    if (ref.current?.parentElement) observer?.observe(ref.current.parentElement);
    return () => { window.removeEventListener("resize", fit); observer?.disconnect(); };
  }, [fit]);
  return (
    <textarea
      ref={ref}
      rows={1}
      placeholder="Untitled"
      aria-label="Page title"
      className={cn("block w-full resize-none overflow-hidden bg-transparent outline-none placeholder:text-muted-foreground/50", ITEM_TITLE)}
      {...props}
    />
  );
}

function Smiley({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8" />
      <path d="M9 9.5h.01M15 9.5h.01" />
    </svg>
  );
}
