import { useRpc } from "@get-bb/plugin-sdk/app";
import { useStudioOpen } from "../../ui/studio-open";
import { Icon } from "../../kit/ui/index";
import { pagePath } from "../constants";
import { OpenInPages, PanelShell, usePanelPage } from "./PanelShell";
import { MissingPageRecovery } from "./MissingPageRecovery";
import { relativeTime } from "./shared";
import { usePageTitle } from "./use-page-title";
import type { PageMetaView, rpcContract } from "../contract";
import { NoteActions } from "./notes/NoteActions";

/**
 * A page in the thread's Studio tab: the same live editor, column, icon and
 * title as the Pages view, with a way back to the collection. It brings the
 * editor, so the tab loads it when first shown.
 */
export function PageTab({ pageId, backLabel, onBack }: { pageId: string; backLabel?: string; onBack?(): void }) {
  const { page, refetch } = usePanelPage(pageId);

  if (page === null) return <MissingPageRecovery key={pageId} pageId={pageId} onRetryPage={refetch} onBack={onBack} backLabel={backLabel ? `Back to ${backLabel}` : undefined} />;
  if (!page) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  return <LoadedPageTab key={page.id} page={page} backLabel={backLabel} onBack={onBack} />;
}

function LoadedPageTab({ page, backLabel, onBack }: { page: PageMetaView; backLabel?: string; onBack?(): void }) {
  const rpc = useRpc<typeof rpcContract>();
  const open = useStudioOpen();
  // One title controller for the big title and the header's saving line, the same one the Pages view uses.
  const titleSave = usePageTitle(page, rpc);
  const saving = titleSave.status === "pending" || titleSave.status === "saving";

  return (
    <PanelShell
      page={page}
      titleSave={titleSave}
      header={
        <>
        {/* Slim: the page's icon and title are in the body, as in the Pages view. */}
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
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" data-panel-edited="">
            {saving ? "Saving title…" : `Edited ${relativeTime(page.updatedAt)}`}
          </span>
          {/* The way out: the other place from a thread's workbench is the Studio app. */}
          <OpenInPages onOpen={() => open({ href: pagePath(page.id), title: titleSave.title || page.title }, { alternate: true })} />
        </header>
        {/* A temp note from the composer: Send to thread, Keep, Discard. */}
        <NoteActions pageId={page.id} layout="row" onDiscarded={onBack} />
        </>
      }
    />
  );
}
