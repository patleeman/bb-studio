import { untitled } from "@bb-studio/kit/format";
import { openAppPath } from "@bb-studio/kit/app";
import { Icon } from "@bb-studio/kit/ui";
import { pagePath } from "../constants";
import { OpenInPages, PanelShell, usePanelPage } from "./PanelShell";
import { MissingPageRecovery } from "./MissingPageRecovery";
import { relativeTime } from "./shared";
import { NoteActions } from "./notes/NoteActions";

/**
 * A page in the thread's Studio tab: the same live editor as the Pages view,
 * with a way back to the collection. It brings the editor, so the tab loads
 * it when first shown.
 */
export function PageTab({ pageId, backLabel, onBack }: { pageId: string; backLabel?: string; onBack?(): void }) {
  const { page, refetch } = usePanelPage(pageId);

  if (page === null) return <MissingPageRecovery key={pageId} pageId={pageId} onRetryPage={refetch} onBack={onBack} backLabel={backLabel ? `Back to ${backLabel}` : undefined} />;
  if (!page) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;

  return (
    <PanelShell
      page={page}
      header={
        <>
        <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
          {onBack ? (
            <button
              type="button"
              className="-ml-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground"
              title={`Back to ${backLabel}`}
              aria-label={`Back to ${backLabel}`}
              onClick={onBack}
            >
              <Icon name="ArrowLeft" className="size-4" />
            </button>
          ) : null}
          {page.icon ? <span className="shrink-0 text-base leading-none">{page.icon}</span> : <Icon name="studio/pages" fallback="FileText" className="size-4 shrink-0 text-muted-foreground" />}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{untitled(page.title)}</div>
            <div className="truncate text-[11px] text-muted-foreground">Edited {relativeTime(page.updatedAt)}</div>
          </div>
          <OpenInPages onOpen={() => openAppPath(pagePath(page.id))} />
        </header>
        {/* A temp note from the composer: Send to thread, Keep, Discard. */}
        <NoteActions pageId={page.id} layout="row" onDiscarded={onBack} />
        </>
      }
    />
  );
}

