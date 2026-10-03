import { useEffect, useState, useSyncExternalStore } from "react";
import { PageConnection } from "./connection";

const actionClass = "min-h-11 rounded-md border border-border px-3 py-2 text-sm hover:bg-state-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground";
const noopSubscribe = () => () => {};

/** Metadata can disappear before the retained draft; never sync this view. */
export function MissingPageRecovery({ pageId, onBack, onRetryPage, backLabel = "All pages" }: { pageId: string; onBack?(): void; onRetryPage?(): void; backLabel?: string }) {
  const [connection, setConnection] = useState<PageConnection | null>(null);
  useEffect(() => {
    const next = new PageConnection(pageId, { recoveryOnly: true });
    setConnection(next);
    return () => next.destroy();
  }, [pageId]);
  useSyncExternalStore(
    connection ? listener => connection.subscribe(listener) : noopSubscribe,
    () => connection?.snapshot ?? "loading",
  );
  const loading = !connection || connection.localSave === "loading";
  const recovered = connection?.hasRecovery;
  const failed = connection?.localSave === "failed";

  return (
    <div className="h-full overflow-auto bg-background p-6 text-foreground">
      <div className="mx-auto flex max-w-md flex-col gap-3 text-center">
        <h2 className="text-lg font-semibold">Page unavailable</h2>
        <p className="text-sm text-muted-foreground">It may have been deleted, or BB could not load its details.</p>
        <div role="status" className="space-y-2 text-sm">
          {loading ? <p>Checking local recovery…</p> : recovered ? (
            <>
              <p>A local recovery copy is available. This view will not sync it or recreate the page.</p>
              {failed ? <p>Local storage failed. Keep this view open until you download the recovery file or retry local recovery successfully.</p> : <p>The recovery copy is saved in this browser.</p>}
              <p className="text-muted-foreground">The .yjs recovery file preserves blocks and comments. It requires a Yjs recovery tool; Pages cannot import it through the normal editor.</p>
            </>
          ) : failed ? <p>Could not read local recovery. Retry reading it to check for a retained draft.</p> : <p>No local recovery was found in this browser.</p>}
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {recovered ? <button type="button" className={actionClass} onClick={() => connection?.exportRecovery()}>Download recovery file</button> : null}
          {!loading && failed ? <button type="button" className={actionClass} onClick={() => recovered ? connection?.retrySave() : connection?.retryRecovery()}>{recovered ? "Retry local recovery" : "Retry reading recovery"}</button> : null}
          {onRetryPage ? <button type="button" className={actionClass} onClick={onRetryPage}>Retry loading page</button> : null}
          {onBack ? <button type="button" className={actionClass} onClick={onBack}>{backLabel}</button> : null}
        </div>
      </div>
    </div>
  );
}
