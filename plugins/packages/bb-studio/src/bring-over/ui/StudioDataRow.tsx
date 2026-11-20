// Settings → Bring things over → "BB Studio data (Bots, pages, memory,
// tasks)". bb's Studio data replaces this install's in three steps, none of
// which changes Studio while it runs:
//   1. Copy: the server copies bb's Studio data into a staging folder.
//   2. Confirm: Studio says what the copy holds and what happens; Bring over
//      brings the Bots' threads over as an ordinary job.
//   3. Restart: Studio applies the copy at its next start, with every Bot
//      stopped (src/studio-data/start.ts).
// Afterwards the old data can be put back (at the next start too) or deleted.
// Every change needs BB Studio's own window (the UI token).
import { useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { errorMessage, relativeTime } from "../../kit/format";
import { Button } from "../../kit/ui/index";
import { Card, Row, SubHeading } from "../../settings/ui/controls";
import type { studioDataContract, StudioDataStatusView } from "../../studio-data/contract";
import {
  copyStudioData,
  deleteOldStudioData,
  discardStudioData,
  putBackStudioData,
  readStudioData,
  startBringOver,
  studioDataConfirm,
  studioDataLine,
  type BringOverJob,
  type BringOverStudioData,
} from "../api";

const LABEL = "BB Studio data (Bots, pages, memory, tasks)";

type Ask = "put-back" | "delete" | null;

export function StudioDataRow({ token, jobRunning, onJob }: { token: string | null; jobRunning: boolean; onJob(job: BringOverJob): void }) {
  const rpc = useRpc<typeof studioDataContract>();
  const [server, setServer] = useState<BringOverStudioData | null>(null);
  const [status, setStatus] = useState<StudioDataStatusView | null>(null);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<Ask>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const [nextServer, nextStatus] = await Promise.all([readStudioData(), rpc.call("studioData.status", null).catch(() => null)]);
    setServer(nextServer);
    setStatus(nextStatus);
  }, [rpc]);
  useEffect(() => { void load(); }, [load, jobRunning]);
  if (!server?.inBb && !server?.journal) return null;

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await work(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); setAsk(null); await load(); }
  };
  /** Opening or closing a confirm step starts fresh: the last action's error goes. */
  const choose = (next: Ask) => { setError(null); setAsk(next); };
  const gated = token !== null;
  const state = server.journal?.state ?? status?.journal?.state ?? null;
  const preview = status?.preview ?? null;
  const own = status?.ownData.has ? status.ownData.reason : null;
  const journalError = server.journal?.error ?? null;
  const lines: string[] = [studioDataLine(server)];
  let buttons: ReactNode = null;

  const copy = () => act(() => copyStudioData(token ?? ""));
  const discard = (label = "Cancel") => <Button size="sm" variant="outline" disabled={busy || jobRunning} onClick={() => void act(() => discardStudioData(token ?? ""))}>{label}</Button>;

  if (state === null || state === "staging") {
    if (own) lines.push(`BB Studio already has data of its own (${own}), so bb's can't replace it. bb's Bots, pages and tasks can only replace a new install's; bb's projects and threads can still come over below.`);
    else if (status === null) lines.push("Studio isn't answering, so this can't be offered now.");
    if (state === "staging") lines.push("bb's Studio data is being copied, or the copy was cut off.");
    if (gated && !own && status !== null) buttons = state === "staging" ? discard("Discard") : <Button size="sm" variant="outline" disabled={busy || jobRunning} onClick={() => void copy()}>{busy ? "Copying…" : "Bring over…"}</Button>;
  } else if (state === "staged") {
    if (journalError) lines.push(journalError);
    if (preview?.problem) lines.push(preview.problem);
    else if (own) lines.push(`BB Studio has data of its own now (${own}), so bb's can't replace it.`);
    else if (preview) lines.push(...studioDataConfirm(preview));
    if (gated) {
      const ready = !!preview && !preview.problem && !own;
      buttons = (
        <span className="flex gap-2">
          {discard()}
          {ready ? <Button size="sm" disabled={busy || jobRunning} onClick={() => void act(async () => onJob(await startBringOver({ picks: preview.threads.wanted.map((id) => ({ kind: "thread" as const, id })), attachments: true, settings: [], studioData: { required: preview.threads.required } }, token ?? "")))}>{jobRunning ? "Bringing over…" : "Bring over"}</Button> : null}
        </span>
      );
    }
  } else if (state === "ready" || state === "applying" || state === "rolling-back") {
    lines.push("bb's Studio data is ready. Quit and reopen BB Studio to finish.");
    if (gated && state === "ready") buttons = discard();
  } else if (state === "applied") {
    const at = server.journal?.appliedAt;
    lines.push(`Brought over${at ? ` ${relativeTime(at)}` : ""}. bb's Bots are stopped here: resume each one from its page. If you resume one here, stop it in bb so it doesn't run twice.`);
    if (journalError) lines.push(journalError);
    if (status?.keptIn) lines.push(`Your old Studio data is kept in ${status.keptIn}.`);
    if (ask === "put-back") lines.push("Puts your old Studio data back the next time BB Studio starts. bb's data is kept in a folder. The threads that came over stay.");
    if (ask === "delete") lines.push("Deletes your old Studio data for good. This can't be undone.");
    if (gated) buttons = ask ? (
      <span className="flex gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => choose(null)}>Cancel</Button>
        <Button size="sm" disabled={busy} onClick={() => void act(() => (ask === "put-back" ? putBackStudioData(token ?? "") : deleteOldStudioData(token ?? "")))}>{ask === "put-back" ? "Put it back" : "Delete it"}</Button>
      </span>
    ) : (
      <span className="flex gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => choose("delete")}>Delete old data…</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => choose("put-back")}>Put my old Studio data back…</Button>
      </span>
    );
  } else if (state === "restore-requested" || state === "restoring") {
    lines.push("Quit and reopen BB Studio to put your old Studio data back.");
  } else if (state === "restored") {
    lines.push("Your old Studio data is back.");
    if (status?.keptIn) lines.push(`bb's Studio data is kept in ${status.keptIn}.`);
    if (gated) buttons = ask === "delete" ? (
      <span className="flex gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => choose(null)}>Cancel</Button>
        <Button size="sm" disabled={busy} onClick={() => void act(() => deleteOldStudioData(token ?? ""))}>Delete it</Button>
      </span>
    ) : <Button size="sm" variant="outline" disabled={busy} onClick={() => choose("delete")}>Delete bb's copy…</Button>;
    if (ask === "delete") lines.push("Deletes bb's Studio data and anything you made in Studio while it was in use. This can't be undone.");
  } else {
    lines.push(journalError ?? "Bringing over bb's Studio data didn't finish.");
    if (gated && (state === "refused" || state === "failed")) buttons = discard("Discard");
  }

  return (
    <>
    <SubHeading>BB Studio data</SubHeading>
    <Card>
    <Row label={LABEL} testId="bring-over-studio-data" description={<>
      {lines.map((line, index) => <span key={index} className={index === 0 ? "block" : "block text-foreground"}>{line}</span>)}
      {server.journal && state !== "staged" && state !== "applied" && state !== "restored" && server.journal.stagedAt ? <span className="block">Copied {relativeTime(server.journal.stagedAt)}</span> : null}
      {error ? <span className="block text-destructive">{error}</span> : null}
    </>}>
      {buttons}
    </Row>
    </Card>
    </>
  );
}
