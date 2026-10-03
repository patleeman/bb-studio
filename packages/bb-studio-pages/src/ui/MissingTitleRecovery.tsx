import { useEffect, useMemo, useState } from "react";
import { TitleRecovery } from "./page-title";

const actionClass = "min-h-11 rounded-md border border-border px-3 py-2 text-sm hover:bg-state-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground";
function readRecovery(recovery: TitleRecovery) {
  let drafts = recovery.memory();
  let error: string | null = null;
  try { drafts = recovery.load(); } catch (cause) { error = String(cause); }
  const browserRecovery = recovery.exportRecords();
  error ??= browserRecovery.error ?? null;
  return { drafts, error, browserRecovery, unpersisted: recovery.hasUnpersisted() };
}

/** A missing page can retain titles even when its content was fully saved. */
export function MissingTitleRecovery({ pageId }: { pageId: string }) {
  const recovery = useMemo(() => new TitleRecovery(location.origin, pageId), [pageId]);
  const [snapshot, setSnapshot] = useState(() => readRecovery(recovery));
  useEffect(() => {
    const refresh = () => setSnapshot(readRecovery(recovery));
    refresh();
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, [recovery]);

  const retry = () => {
    let error: string | null = null;
    // Retry only immutable local records. Never update or recreate metadata.
    if (snapshot.unpersisted) for (const draft of recovery.memory()) {
      try { recovery.save(draft); } catch (cause) { error ??= String(cause); }
    }
    const next = readRecovery(recovery);
    setSnapshot({ ...next, error: error ?? next.error });
  };
  const canExport = snapshot.drafts.length > 0 || Object.keys(snapshot.browserRecovery.records).length > 0;
  const download = () => {
    const latest = recovery.exportRecords();
    const drafts = [...new Map([...snapshot.drafts, ...recovery.memory()].map(draft => [draft.id, draft])).values()];
    const text = JSON.stringify({
      origin: recovery.origin, pageId, drafts,
      browserRecovery: { records: { ...snapshot.browserRecovery.records, ...latest.records }, error: latest.error ?? snapshot.browserRecovery.error },
      readError: snapshot.error,
    }, null, 2);
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = `${pageId}-title-recovery.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  if (!canExport && !snapshot.error && !snapshot.unpersisted) return null;

  return (
    <section aria-label="Title recovery" className="space-y-3 rounded-md border border-border p-3 text-sm">
      <h3 className="font-medium">Title recovery</h3>
      {snapshot.drafts.map(draft => <p key={draft.id} className="break-words"><span className="text-muted-foreground">Retained title: </span>{draft.title || "(Untitled)"}</p>)}
      {snapshot.error ? <p role="status">Could not read all title recovery data. Available records can still be downloaded; retry reading to check the rest.</p> : null}
      {snapshot.unpersisted ? <p role="status">Keep this view open until you download the title recovery file or retry local title recovery successfully. Some titles are only kept in this open browser.</p> : null}
      {canExport ? <p className="text-muted-foreground">The JSON file keeps retained titles and raw recovery records. Downloading it will not update or recreate the page.</p> : null}
      <div className="flex flex-wrap justify-center gap-2">
        {canExport ? <button type="button" className={actionClass} onClick={download}>Download title recovery</button> : null}
        {snapshot.error || snapshot.unpersisted ? <button type="button" className={actionClass} onClick={retry}>{snapshot.unpersisted ? "Retry local title recovery" : "Retry reading title recovery"}</button> : null}
      </div>
    </section>
  );
}
