// `::recording{id="rec_…"}` in a reply: the recording's summary and the start
// of its transcript, read-only, under a header that opens the recording.
import { useCallback, useEffect, useState } from "react";
import { ItemDirectiveCard, remember } from "@bb-studio/kit/app";
import { useBbNavigate, useRealtime, useRpc, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import type { Recording, Segment, rpcContract } from "../shared/contract";
import { PANEL_PATH, RECORDING_CHANGED, TALK_ICON, formatClock, formatLength } from "../shared/format";

/** Transcript lines a card shows before it points at the rest. */
export const PREVIEW_LINES = 6;

export const isRecordingId = (value: string) => /^rec_[a-z0-9]{8,32}$/.test(value);

type Loaded = { recording: Recording; segments: Segment[] };

/** The recording and its segments, kept current as it changes. Null once it's gone. */
function useRecording(id: string): Loaded | null | undefined {
  const rpc = useRpc<typeof rpcContract>();
  const [loaded, setLoaded] = useState<Loaded | null | undefined>(undefined);
  const load = useCallback(() => {
    if (!id) return;
    rpc.call("recording_get", { id }).then(setLoaded, () => setLoaded(null));
  }, [rpc, id]);
  useEffect(load, [load]);
  useRealtime(RECORDING_CHANGED, (payload) => {
    if ((payload as { id?: unknown } | null)?.id === id) load();
  });
  return loaded;
}

/** The transcribed lines, cleaned where a cleanup was saved, and how many there are. */
export function transcriptLines(segments: readonly Segment[]): { lines: { id: string; at: number; text: string }[]; total: number } {
  const all = segments.flatMap((segment) => {
    const text = (segment.cleanedText ?? segment.text ?? "").trim();
    return text ? [{ id: segment.id, at: segment.offsetMs, text }] : [];
  });
  return { lines: all.slice(0, PREVIEW_LINES), total: all.length };
}

function RecordingPreview({ recording, segments }: Loaded) {
  const { lines, total } = transcriptLines(segments);
  const summary = recording.meetingNotes?.summary.trim();
  const waiting = recording.status !== "done" || recording.pendingCount > 0;
  return (
    <div className="flex flex-col gap-2 px-3 py-2.5 text-sm">
      {summary ? <p className="leading-relaxed">{summary}</p> : null}
      {lines.length ? (
        <ol className="flex flex-col gap-0.5">
          {lines.map((line) => (
            <li key={line.id} className="flex gap-2 text-xs">
              <span className="w-10 shrink-0 text-muted-foreground tabular-nums">{formatClock(line.at)}</span>
              <span className="min-w-0 flex-1 line-clamp-2">{line.text}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-xs text-muted-foreground">{waiting ? "Transcribing…" : "Nothing was transcribed."}</p>
      )}
      {total > lines.length ? <p className="text-xs text-muted-foreground">{total - lines.length} more parts</p> : null}
    </div>
  );
}

export function RecordingCard({ attributes }: PluginMessageDirectiveProps) {
  const navigate = useBbNavigate();
  const id = attributes.id ?? "";
  const valid = isRecordingId(id);
  const loaded = remember(`recording:${id}`, useRecording(valid ? id : ""));
  if (!valid || loaded === null) return <ItemDirectiveCard state="deleted" kind="recording" icon={TALK_ICON} />;
  if (!loaded) return <ItemDirectiveCard state="loading" kind="recording" icon={TALK_ICON} />;
  const { recording } = loaded;
  return (
    <ItemDirectiveCard
      state="ready"
      kind="recording"
      icon={TALK_ICON}
      title={recording.title.trim() || "Untitled recording"}
      details={`Recording · ${formatLength(recording.durationMs)} · ${recording.wordCount} words`}
      body={<RecordingPreview {...loaded} />}
      // Talk has no workbench tab: its own page shows the recording.
      onOpen={() => navigate.toPluginPanel(PANEL_PATH, { subPath: id })}
    />
  );
}
