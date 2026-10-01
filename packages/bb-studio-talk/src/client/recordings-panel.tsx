// The Recordings page: /plugins/talk/recordings lists every recording, and
// /plugins/talk/recordings/<id> is one recording's durable home — the link
// target for mentions and the CLI. With BB Studio installed, the list is
// Studio's collection.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AddOnCollection,
  Badge,
  DANGER_BUTTON,
  DropdownMenuItem,
  EditableTitle,
  GHOST_BUTTON,
  ICON_BUTTON,
  ItemHeader,
  ItemDeleteConfirm,
  ItemMenu,
  openNewItemThread,
  OUTLINE_BUTTON,
  PageColumn,
  openAppPath,
  studioPath,
  useStudioPresent,
  type ProviderCall,
} from "@bb-studio/kit/app";
import type { StudioSchemas } from "@bb-studio/kit/contract";
import { errorMessage, formatBytes, shortDateTime } from "@bb-studio/kit/format";
import {
  useBbNavigate,
  useRealtime,
  useRpc,
  type PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";
import type { Recording, Segment, TalkRpcContract } from "../shared/contract";
import {
  PANEL_PATH,
  RECORDING_CHANGED,
  UNSENT_PATH,
  formatClock,
  formatLength,
  joinTranscript,
  recordingBadge,
  recordingHref,
} from "../shared/format";
import { Icon } from "@bb-studio/kit/ui";
import { cn } from "@bb-studio/kit/ui";
import { talk, useTalkState } from "./controller";
import { sameKey, type SetAsideSegment } from "./outbox";

function useChangedSignal(onChange: (id: string) => void): void {
  useRealtime(RECORDING_CHANGED, (payload) => {
    const id = (payload as { id?: unknown } | null)?.id;
    if (typeof id === "string") onChange(id);
  });
}

// ── List ─────────────────────────────────────────────────────────────────
function RecordingList() {
  const rpc = useRpc<StudioSchemas["provider"]>();
  const call = useCallback<ProviderCall>((method, input) => rpc.call(method, input as never) as never, [rpc]);
  const [version, setVersion] = useState(0);
  useChangedSignal(() => setVersion((value) => value + 1));
  const { setAside } = useTalkState();
  // Studio's collection can't show unsent audio, so this page stays while
  // there is some.
  if (setAside === null) return null;
  return (
    <div className="flex h-full flex-col">
      <UnsentNotice className="mx-10 mt-6 max-md:mx-4" />
      <div className="min-h-0 flex-1">
        <AddOnCollection
          pluginId="talk"
          title="Recordings"
          kind="recording"
          call={call}
          refreshKey={version}
          handOver={setAside.length === 0}
        />
      </div>
    </div>
  );
}

// ── Unsent audio ─────────────────────────────────────────────────────────

/** Points at audio this device kept because the server refused it. */
function UnsentNotice({ recordingId, className }: { recordingId?: string; className?: string }) {
  const setAside = useTalkState().setAside ?? [];
  const navigate = useBbNavigate();
  const count = setAside.filter((segment) => !recordingId || segment.recordingId === recordingId).length;
  if (count === 0) return null;
  const what = count === 1 ? "A piece of audio" : `${count} pieces of audio`;
  return (
    <div className={cn("flex items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm max-md:flex-wrap", className)}>
      <Icon name="CloudOff" className="size-4 shrink-0 text-amber-600" />
      <span className="min-w-0 flex-1">
        {what}
        {recordingId ? " from this recording" : ""} couldn't be uploaded and {count === 1 ? "is" : "are"} kept on this device.
      </span>
      <button type="button" className={OUTLINE_BUTTON} onClick={() => navigate.toPluginPanel(PANEL_PATH, { subPath: UNSENT_PATH })}>
        Review
      </button>
    </div>
  );
}

function UnsentAudio() {
  const setAside = useTalkState().setAside ?? [];
  const navigate = useBbNavigate();
  const studio = useStudioPresent();
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState<readonly SetAsideSegment[] | null>(null);
  const act = (work: () => Promise<unknown>) => {
    setBusy(true);
    void work()
      .catch((cause: unknown) => toast.error(errorMessage(cause)))
      .finally(() => setBusy(false));
  };
  const toCollection = () => (studio ? openAppPath(studioPath("recording")) : navigate.toPluginPanel(PANEL_PATH));
  return (
    <div className="relative h-full">
      <ItemHeader backLabel={studio ? "Studio" : "Recordings"} onBack={toCollection} />
      <PageColumn className="max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Unsent audio</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The server refused these pieces of audio, so Talk kept them on this device instead of losing them. Retry
          after updating Talk, download them, or discard them.
        </p>
        {setAside.length === 0 ? (
          <p className="mt-8 text-sm text-muted-foreground">Nothing here: every piece of audio was uploaded.</p>
        ) : (
          <>
            <div className="mt-6 flex flex-wrap gap-2">
              <button type="button" className={OUTLINE_BUTTON} disabled={busy} onClick={() => act(() => talk.retrySetAside(setAside))}>
                <Icon name="RotateCcw" /> Retry all
              </button>
              <button type="button" className={GHOST_BUTTON} disabled={busy} onClick={() => setConfirmDiscard(setAside)}>
                <Icon name="Trash2" /> Discard all…
              </button>
            </div>
            {confirmDiscard ? (
              <div className="mt-4 flex items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm max-md:flex-wrap">
                <span className="min-w-0 flex-1">
                  Delete {confirmDiscard.length === 1 ? "this audio" : `these ${confirmDiscard.length} pieces of audio`} from this
                  device? This can't be undone.
                </span>
                <button
                  type="button"
                  className={DANGER_BUTTON}
                  onClick={() => {
                    const keys = confirmDiscard;
                    setConfirmDiscard(null);
                    act(() => talk.discardSetAside(keys));
                  }}
                >
                  Discard
                </button>
                <button type="button" className={GHOST_BUTTON} onClick={() => setConfirmDiscard(null)}>
                  Cancel
                </button>
              </div>
            ) : null}
            <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
              {setAside.map((segment) => (
                <li key={`${segment.recordingId}:${segment.sessionId}:${segment.index}`} className="flex items-center gap-3 px-4 py-3 text-sm max-md:flex-wrap">
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      className="font-medium hover:underline"
                      onClick={() => navigate.toPluginPanel(PANEL_PATH, { subPath: segment.recordingId })}
                    >
                      {shortDateTime(segment.startedAt)}
                    </button>
                    <span className="text-muted-foreground">
                      {" · "}
                      {segment.durationMs === null ? "unknown length" : formatLength(segment.durationMs)} · {formatBytes(segment.bytes)}
                    </span>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground" title={segment.reason}>
                      {segment.reason}
                    </p>
                  </div>
                  <button type="button" aria-label="Retry" title="Retry" className={ICON_BUTTON} disabled={busy} onClick={() => act(() => talk.retrySetAside([segment]))}>
                    <Icon name="RotateCcw" className="size-4" />
                  </button>
                  <button type="button" aria-label="Download" title="Download" className={ICON_BUTTON} onClick={() => act(() => talk.downloadSetAside(segment))}>
                    <Icon name="Download" className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Discard"
                    title="Discard"
                    className={ICON_BUTTON}
                    disabled={busy}
                    onClick={() => setConfirmDiscard(setAside.filter((other) => sameKey(other, segment)))}
                  >
                    <Icon name="Trash2" className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </PageColumn>
    </div>
  );
}

// ── One recording ────────────────────────────────────────────────────────
function useRecording(id: string) {
  const rpc = useRpc<TalkRpcContract>();
  const [data, setData] = useState<{ recording: Recording; segments: Segment[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refetch = useCallback(() => {
    rpc.call("recording_get", { id }).then(
      (result) => {
        setData(result);
        setError(null);
      },
      (cause) => setError(errorMessage(cause)),
    );
  }, [rpc, id]);
  useEffect(() => {
    setData(null);
    refetch();
  }, [refetch]);
  useChangedSignal((changed) => {
    if (changed === id) refetch();
  });
  return { rpc, data, error, refetch };
}

/** Plays segment files back to back, starting from any one of them. */
function usePlayer(recordingId: string, segments: readonly Segment[]) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const order = useRef(segments);
  order.current = segments;

  const stop = useCallback(() => {
    audio.current?.pause();
    audio.current = null;
    setPlaying(null);
  }, []);

  const play = useCallback(
    (segmentId: string) => {
      audio.current?.pause();
      const element = new Audio(
        `/api/v1/plugins/talk/http/audio?recording=${encodeURIComponent(recordingId)}&segment=${encodeURIComponent(segmentId)}`,
      );
      audio.current = element;
      setPlaying(segmentId);
      element.addEventListener("ended", () => {
        if (audio.current !== element) return;
        const list = order.current;
        const next = list[list.findIndex((segment) => segment.id === segmentId) + 1];
        if (next) play(next.id);
        else stop();
      });
      element.play().catch((error: unknown) => {
        if (audio.current === element) stop();
        toast.error(`Could not play audio: ${errorMessage(error)}`);
      });
    },
    [recordingId, stop],
  );

  useEffect(() => stop, [stop, recordingId]);
  return { playing, play, stop };
}

interface Paragraph {
  sessionId: string;
  offsetMs: number;
  segments: Segment[];
}

function paragraphs(segments: readonly Segment[]): Paragraph[] {
  const out: Paragraph[] = [];
  for (const segment of segments) {
    const last = out.at(-1);
    if (last && last.sessionId === segment.sessionId) last.segments.push(segment);
    else out.push({ sessionId: segment.sessionId, offsetMs: segment.offsetMs, segments: [segment] });
  }
  return out;
}

function RecordingDetail({ id }: { id: string }) {
  const { rpc, data, error, refetch } = useRecording(id);
  const navigate = useBbNavigate();
  const studio = useStudioPresent();
  const state = useTalkState();
  const segments = data?.segments ?? [];
  const player = usePlayer(id, segments);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const transcript = useMemo(() => joinTranscript(segments), [segments]);
  const groups = useMemo(() => paragraphs(segments), [segments]);
  // Tells the recording pill this page is where the recording lives.
  useEffect(() => {
    talk.setViewing(id);
    return () => talk.setViewing(null);
  }, [id]);
  // With Studio installed, the collection is Studio's.
  const toCollection = useCallback(
    (replace = false) => (studio ? openAppPath(studioPath("recording"), { replace }) : navigate.toPluginPanel(PANEL_PATH, { replace })),
    [navigate, studio],
  );
  // The recording went away while open: deleted elsewhere, or discarded
  // because it finished without a word.
  const gone = Boolean(data && error && /No recording/.test(error));
  const wasEmpty = data?.recording.wordCount === 0;
  const leaving = useRef(false);
  useEffect(() => {
    if (!gone || leaving.current) return;
    leaving.current = true;
    toast.info(wasEmpty ? "Talk heard nothing, so it didn't keep this recording." : "This recording was deleted.");
    toCollection(true);
  }, [gone, wasEmpty, toCollection]);

  const backLabel = studio ? "Studio" : "Recordings";
  if (error && !data) {
    return (
      <div className="relative h-full">
        <ItemHeader backLabel={backLabel} onBack={() => toCollection()} />
        <PageColumn className="max-w-3xl">
          <p className="text-sm text-destructive">{error}</p>
        </PageColumn>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="relative h-full">
        <ItemHeader backLabel={backLabel} onBack={() => toCollection()} />
        <PageColumn className="max-w-3xl">
          <p className="text-sm text-muted-foreground">Loading…</p>
        </PageColumn>
      </div>
    );
  }
  const { recording } = data;
  const activeHere = state.recordingId === id && state.phase !== "idle";
  const badge = recordingBadge(recording, activeHere && state.phase === "recording");
  const run = (work: () => Promise<unknown>) => {
    void work().then(refetch, (cause) => toast.error(errorMessage(cause)));
  };
  const copy = () =>
    void navigator.clipboard.writeText(transcript).then(
      () => toast.success("Transcript copied"),
      (cause: unknown) => toast.error(errorMessage(cause)),
    );
  const downloadTranscript = (format: "markdown" | "text") => {
    window.open(`/api/v1/plugins/talk/http/transcript?recording=${encodeURIComponent(id)}&format=${format}`, "_blank", "noopener");
  };

  return (
    <div className="relative h-full">
      <ItemHeader
        backLabel={backLabel}
        onBack={() => toCollection()}
        thread={{ title: recording.title, href: recordingHref(recording.id) }}
        leading={badge ? <Badge label={badge.label} tone={badge.tone} /> : null}
        trailing={
          <>
            <button type="button" aria-label="Copy transcript" title="Copy transcript" className={ICON_BUTTON} disabled={transcript === ""} onClick={copy}>
              <Icon name="Copy" className="size-4" />
            </button>
            <ItemMenu onDelete={() => setConfirmDelete(true)} deleteDisabled={activeHere || recording.status === "recording"}>

                <DropdownMenuItem className="md:hidden" onSelect={() => openNewItemThread(navigate, { title: recording.title, href: recordingHref(recording.id) })}>
                  <Icon name="MessageSquarePlus" className="size-4" /> New thread
                </DropdownMenuItem>
                {recording.failedCount > 0 ? (
                  <DropdownMenuItem onSelect={() => run(() => rpc.call("recording_retry", { id }))}>
                    <Icon name="RotateCcw" className="size-4" /> Retry {recording.failedCount} failed
                  </DropdownMenuItem>
                ) : null}
                {recording.status === "done" ? (
                  <>
                    <DropdownMenuItem onSelect={() => downloadTranscript("markdown")}>Download Markdown</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => downloadTranscript("text")}>Download text</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => window.open(`/api/v1/plugins/talk/http/audio-export?recording=${encodeURIComponent(id)}`, "_blank", "noopener")}>Download audio</DropdownMenuItem>
                  </>
                ) : null}
            </ItemMenu>
          </>
        }
      />
      <PageColumn className="max-w-3xl">
        <EditableTitle
          title={recording.title}
          placeholder="Untitled recording"
          onRename={(title) =>
            void rpc.call("recording_rename", { id, title }).then(refetch, (cause: unknown) => toast.error(errorMessage(cause)))
          }
        />
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span>{shortDateTime(recording.createdAt)}</span>
          <span aria-hidden>·</span>
          <span>{formatLength(recording.durationMs)}</span>
          <span aria-hidden>·</span>
          <span>{recording.wordCount.toLocaleString()} words</span>
          {recording.kind === "dictation" ? (
            <>
              <span aria-hidden>·</span>
              <span>Dictation</span>
            </>
          ) : null}
        </div>

        <UnsentNotice recordingId={id} className="mt-6" />

        {recording.kind === "recording" && recording.status === "done" ? (
          <section className="mt-6 rounded-lg border border-border p-4" aria-label="Meeting notes">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold">Meeting notes</h2>
              <button type="button" className={OUTLINE_BUTTON} onClick={() => run(() => rpc.call("meeting_regenerate", { id }))}>
                <Icon name="RotateCcw" /> {recording.meetingNotes ? "Regenerate" : "Generate"}
              </button>
            </div>
            {recording.meetingNotes ? (
              <div className="mt-3 space-y-4 text-sm">
                <p>{recording.meetingNotes.summary}</p>
                {recording.meetingNotes.decisions.length ? <div><h3 className="font-medium">Decisions</h3><ul className="mt-1 list-disc pl-5">{recording.meetingNotes.decisions.map((decision, index) => <li key={index}>{decision}</li>)}</ul></div> : null}
                {recording.meetingNotes.actionItems.length ? <div><h3 className="font-medium">Action items</h3><ul className="mt-2 space-y-2">{recording.meetingNotes.actionItems.map((item, index) => <li key={index} className="flex items-center justify-between gap-3"><span>{item.title}{item.assignee ? <span className="text-muted-foreground"> · Suggested: {item.assignee === "me" ? "you" : "agent"}</span> : null}</span><button type="button" className={OUTLINE_BUTTON} onClick={() => run(async () => { const result = await rpc.call("meeting_create_task", { id, index }); toast.success(`Task created: ${result.taskId}`); })}>Create task</button></li>)}</ul></div> : null}
              </div>
            ) : <p className="mt-3 text-sm text-muted-foreground">Notes appear after Talk finishes processing the transcript.</p>}
          </section>
        ) : null}

        {confirmDelete ? (
          <div className="mt-6">
            <ItemDeleteConfirm
              label="Delete this recording and its audio? This can't be undone."
              onDelete={() => {
                player.stop();
                void rpc.call("recording_delete", { id }).then(
                  () => toCollection(true),
                  (cause) => toast.error(errorMessage(cause)),
                );
              }}
              onCancel={() => setConfirmDelete(false)}
            />
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-2">
          {activeHere ? (
            <>
              {state.phase === "recording" ? (
                <button type="button" className={OUTLINE_BUTTON} onClick={() => void talk.pause()}>
                  <Icon name="Pause" /> Pause
                </button>
              ) : null}
              {state.phase === "paused" || state.phase === "needs-resume" ? (
                <button type="button" className={OUTLINE_BUTTON} onClick={() => void talk.resume()}>
                  <Icon name="Mic" /> Resume
                </button>
              ) : null}
              {state.phase === "recording" || state.phase === "paused" || state.phase === "needs-resume" ? (
                <button type="button" className={DANGER_BUTTON} onClick={() => void talk.stop(false)}>
                  <Icon name="Square" /> Stop
                </button>
              ) : null}
            </>
          ) : recording.status !== "finishing" ? (
            <button
              type="button"
              className={OUTLINE_BUTTON}
              disabled={state.phase !== "idle"}
              onClick={() => void talk.continueRecording(recording)}
            >
              <Icon name="Mic" /> {recording.status === "interrupted" ? "Resume recording" : "Record more"}
            </button>
          ) : null}
        </div>

        {groups.length === 0 ? (
          <div className="mt-8 rounded-lg border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
            {activeHere ? "Text appears here as each piece is transcribed." : "This recording has no audio."}
          </div>
        ) : (
          <div className="mt-8 flex flex-col gap-5">
            {groups.map((group) => (
              <section key={group.sessionId} className="flex gap-3">
                <button
                  type="button"
                  onClick={() => player.play(group.segments[0]!.id)}
                  className="mt-0.5 h-6 shrink-0 cursor-pointer rounded px-1 font-mono text-xs tabular-nums text-muted-foreground hover:bg-state-hover hover:text-foreground"
                  title="Play from here"
                >
                  {formatClock(group.offsetMs)}
                </button>
                <p className="min-w-0 flex-1 text-[15px] leading-relaxed">
                  {group.segments.map((segment) => (
                    <SegmentText
                      key={segment.id}
                      segment={segment}
                      playing={player.playing === segment.id}
                      onPlay={() => (player.playing === segment.id ? player.stop() : player.play(segment.id))}
                    />
                  ))}
                </p>
              </section>
            ))}
          </div>
        )}
      </PageColumn>
    </div>
  );
}

function SegmentText({ segment, playing, onPlay }: { segment: Segment; playing: boolean; onPlay: () => void }) {
  const at = formatClock(segment.offsetMs);
  if (segment.status === "empty") return null;
  if (segment.status === "pending") {
    return (
      <span className="mr-1 inline-flex items-center gap-1 text-sm text-muted-foreground" title={`${at} — transcribing`}>
        <Icon name="Loading" className="size-3.5 animate-spin motion-reduce:animate-none" />
        {segment.attempts > 0 ? "retrying…" : "…"}
      </span>
    );
  }
  if (segment.status === "failed") {
    return (
      <button
        type="button"
        onClick={onPlay}
        title={segment.error ?? "Transcription failed"}
        className="mr-1 cursor-pointer rounded bg-destructive/10 px-1 text-sm text-destructive"
      >
        [{at} not transcribed]
      </button>
    );
  }
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={onPlay}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onPlay();
        }
      }}
      title={`${at} — play`}
      className={cn(
        "cursor-pointer rounded-sm hover:bg-state-hover",
        playing && "bg-primary/15 hover:bg-primary/20",
      )}
    >
      {segment.text}{" "}
    </span>
  );
}

export function RecordingsPanel({ subPath }: PluginNavPanelProps) {
  const id = subPath.split("/")[0] ?? "";
  if (id === UNSENT_PATH) return <UnsentAudio />;
  return /^rec_[a-z0-9]{8,32}$/.test(id) ? <RecordingDetail id={id} /> : <RecordingList />;
}
