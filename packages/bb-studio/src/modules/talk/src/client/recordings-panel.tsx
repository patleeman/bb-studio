import { useModuleRpc } from "../../../app";
// The Recordings page: /plugins/studio/recordings lists every recording, and
// /plugins/studio/recordings/<id> is one recording's durable home — the link
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
  useOpenCompanion,
  useCompanionNavigate,
  type ProviderCall,
} from "@bb-studio/kit/app";
import type { StudioSchemas } from "@bb-studio/kit/contract";
import { errorMessage, formatBytes, shortDateTime } from "@bb-studio/kit/format";
import {
  useBbNavigate,
  useRealtime,
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
import { RecordingPlayer, type PlaybackState } from "./playback";

function useChangedSignal(onChange: (id: string) => void): void {
  useRealtime(RECORDING_CHANGED, (payload) => {
    const id = (payload as { id?: unknown } | null)?.id;
    if (typeof id === "string") onChange(id);
  });
}

// ── List ─────────────────────────────────────────────────────────────────
function RecordingList() {
  const rpc = useModuleRpc<StudioSchemas["provider"]>("talk");
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
          pluginId="studio"
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
  const open = useOpenCompanion();
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
      <button type="button" className={OUTLINE_BUTTON} onClick={() => open({ kind: "path", path: `/plugins/studio/${PANEL_PATH}/${UNSENT_PATH}` })}>
        Review
      </button>
    </div>
  );
}

function UnsentAudio() {
  const setAside = useTalkState().setAside ?? [];
  const navigate = useBbNavigate();
  const open = useOpenCompanion();
  const within = useCompanionNavigate();
  const studio = useStudioPresent();
  const [busy, setBusy] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState<readonly SetAsideSegment[] | null>(null);
  const act = (work: () => Promise<unknown>) => {
    setBusy(true);
    void work()
      .catch((cause: unknown) => toast.error(errorMessage(cause)))
      .finally(() => setBusy(false));
  };
  const toCollection = () => {
    const path = studio ? studioPath("recording") : `/plugins/studio/${PANEL_PATH}`;
    if (!within({ kind: "path", path })) {
      if (studio) openAppPath(path);
      else navigate.toPluginPanel(PANEL_PATH);
    }
  };
  return (
    <div className="relative h-full">
      <ItemHeader backLabel={studio ? "Studio" : "Recordings"} onBack={toCollection} />
      <PageColumn className="max-w-3xl @max-3xl/page:pt-16">
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
                      onClick={() => open({ kind: "path", path: `/plugins/studio/${PANEL_PATH}/${segment.recordingId}` })}
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
  const rpc = useModuleRpc<TalkRpcContract>("talk");
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

function usePlayer(recordingId: string, segments: readonly Segment[]) {
  const [state, setState] = useState<PlaybackState>({ positionMs: 0, segmentId: null, playing: false, rate: 1, volume: 1 });
  const player = useMemo(() => new RecordingPlayer(recordingId, setState,
    (cause) => toast.error(`Could not play audio: ${errorMessage(cause)}`)), [recordingId]);
  player.segments = segments;
  useEffect(() => { setState(player.state); return () => player.dispose(); }, [player]);
  return { ...state, durationMs: player.durationMs, seek: (ms: number, play?: boolean) => player.seek(ms, play),
    toggle: () => player.toggle(), pause: () => player.pause(), setRate: (rate: number) => player.setRate(rate), setVolume: (volume: number) => player.setVolume(volume) };
}

function RecordingDetail({ id }: { id: string }) {
  const { rpc, data, error, refetch } = useRecording(id);
  const navigate = useBbNavigate();
  const within = useCompanionNavigate();
  const studio = useStudioPresent();
  const state = useTalkState();
  const segments = data?.segments ?? [];
  const player = usePlayer(id, segments);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [version, setVersion] = useState<"original" | "cleaned">("cleaned");
  const [cleaning, setCleaning] = useState<string | null>(null);
  const cleanupRun = useRef(0);
  useEffect(() => { setVersion("cleaned"); setCleaning(null); return () => { cleanupRun.current++; }; }, [id]);
  const spoken = segments.filter((segment) => segment.status !== "empty");
  const hasCleaned = spoken.length > 0 && spoken.every((segment) => segment.status === "done" && segment.cleanedText != null);
  const showCleaned = version === "cleaned" && hasCleaned;
  const shownSegments = useMemo(() => showCleaned ? segments.map((segment) => ({ ...segment, text: segment.cleanedText ?? segment.text })) : segments, [segments, showCleaned]);
  const transcript = useMemo(() => joinTranscript(shownSegments), [shownSegments]);
  const cleanUp = async () => {
    if (cleaning !== null) return;
    const runId = ++cleanupRun.current;
    const pending = segments.filter((segment) => segment.status === "done" && segment.text && segment.cleanedText == null);
    try {
      for (let index = 0; index < pending.length; index++) {
        if (cleanupRun.current !== runId) return;
        setCleaning(`Cleaning section ${index + 1} of ${pending.length}…`);
        await rpc.call("recording_cleanup", { id, segmentId: pending[index]!.id });
      }
      if (cleanupRun.current === runId) { setVersion("cleaned"); toast.success("Cleaned transcript saved. Original text and audio kept."); }
    } catch (cause) {
      if (cleanupRun.current === runId) toast.error(errorMessage(cause));
    } finally {
      if (cleanupRun.current === runId) { setCleaning(null); refetch(); }
    }
  };
  const [follow, setFollow] = useState(true);
  const transcriptRows = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (follow && player.playing && player.segmentId) {
      transcriptRows.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
    }
  }, [follow, player.playing, player.segmentId]);
  // Tells the recording pill this page is where the recording lives.
  useEffect(() => {
    talk.setViewing(id);
    return () => talk.setViewing(null);
  }, [id]);
  // With Studio installed, the collection is Studio's.
  const toCollection = useCallback(
    (replace = false) => {
      const path = studio ? studioPath("recording") : `/plugins/studio/${PANEL_PATH}`;
      if (!within({ kind: "path", path })) {
        if (studio) openAppPath(path, { replace });
        else navigate.toPluginPanel(PANEL_PATH, { replace });
      }
    },
    [navigate, studio, within],
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
        <PageColumn className="max-w-3xl @max-3xl/page:pt-16">
          <p className="text-sm text-destructive">{error}</p>
        </PageColumn>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="relative h-full">
        <ItemHeader backLabel={backLabel} onBack={() => toCollection()} />
        <PageColumn className="max-w-3xl @max-3xl/page:pt-16">
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
    window.open(`/api/v1/plugins/studio/http/transcript?recording=${encodeURIComponent(id)}&format=${format}${showCleaned ? "&version=cleaned" : ""}`, "_blank", "noopener");
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
            <ItemMenu reference={{ title: recording.title, href: recordingHref(recording.id) }} onDelete={() => setConfirmDelete(true)} deleteDisabled={activeHere || recording.status === "recording"}>

                <DropdownMenuItem className="md:hidden" onSelect={() => openNewItemThread(navigate, { title: recording.title, href: recordingHref(recording.id) })}>
                  <Icon name="MessageSquarePlus" className="size-4" /> New thread
                </DropdownMenuItem>
                {recording.kind === "dictation" && recording.status === "done" ? (
                  <DropdownMenuItem
                    onSelect={() => run(() => rpc.call("recording_keep", { id }).then(() => toast.success("Kept as a recording.")))}
                  >
                    <Icon name="Mic" className="size-4" /> Keep as a recording
                  </DropdownMenuItem>
                ) : null}
                {recording.failedCount > 0 ? (
                  <DropdownMenuItem onSelect={() => run(() => rpc.call("recording_retry", { id }))}>
                    <Icon name="RotateCcw" className="size-4" /> Retry {recording.failedCount} failed
                  </DropdownMenuItem>
                ) : null}
                {recording.kind === "recording" && recording.status === "done" ? (
                  <DropdownMenuItem onSelect={() => run(() => rpc.call("meeting_regenerate", { id }))}>
                    <Icon name="List" className="size-4" /> {recording.meetingNotes ? "Regenerate summary" : "Generate summary"}
                  </DropdownMenuItem>
                ) : null}
                {recording.status === "done" ? (
                  <>
                    <DropdownMenuItem onSelect={() => downloadTranscript("markdown")}>Download Markdown</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => downloadTranscript("text")}>Download text</DropdownMenuItem>
                    {recording.audioRemoved ? null : (
                      <DropdownMenuItem onSelect={() => window.open(`/api/v1/plugins/studio/http/audio-export?recording=${encodeURIComponent(id)}`, "_blank", "noopener")}>Download audio</DropdownMenuItem>
                    )}
                  </>
                ) : null}
            </ItemMenu>
          </>
        }
      />
      <PageColumn className="max-w-3xl @max-3xl/page:pt-16">
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

        {recording.audioRemoved ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Talk deleted this dictation's audio to save space. The transcript is kept.
          </p>
        ) : null}

        <UnsentNotice recordingId={id} className="mt-6" />

        {recording.kind === "recording" && recording.meetingNotes ? (
          <details className="mt-6 rounded-lg border border-border p-4" aria-label="Summary">
            <summary className="cursor-pointer font-semibold">Summary</summary>
            <div className="mt-3 flex items-center justify-end gap-3">
              <button type="button" className={OUTLINE_BUTTON} onClick={() => run(() => rpc.call("meeting_regenerate", { id }))}>
                <Icon name="RotateCcw" /> {recording.meetingNotes ? "Regenerate" : "Generate"}
              </button>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm">{recording.meetingNotes.summary}</p>
          </details>
        ) : null}

        {confirmDelete ? (
          <div className="mt-6">
            <ItemDeleteConfirm
              label="Delete this recording and its audio? This can't be undone."
              onDelete={() => {
                player.pause();
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

        {segments.length > 0 && !recording.audioRemoved ? (
          <section aria-label="Audio playback" className="sticky top-14 z-10 mt-6 border-y border-border bg-background py-3">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={OUTLINE_BUTTON} aria-label={player.playing ? "Pause playback" : "Play recording"} onClick={player.toggle}>
                <Icon name={player.playing ? "Pause" : "Play"} /> {player.playing ? "Pause" : "Play"}
              </button>
              <button type="button" className={OUTLINE_BUTTON} aria-label="Back 10 seconds" title="Back 10 seconds" onClick={() => player.seek(player.positionMs - 10_000)}>−10s</button>
              <button type="button" className={OUTLINE_BUTTON} aria-label="Forward 10 seconds" title="Forward 10 seconds" onClick={() => player.seek(player.positionMs + 10_000)}>+10s</button>
              <span className="ml-auto text-sm tabular-nums">{formatClock(player.positionMs)} / {formatClock(player.durationMs)}</span>
              <select aria-label="Playback speed" className="rounded border border-border bg-background px-1 py-1 text-sm" value={player.rate} onChange={(event) => player.setRate(Number(event.target.value))}>
                {[0.75, 1, 1.25, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
              </select>
            </div>
            <input type="range" aria-label="Recording position" aria-valuetext={`${formatClock(player.positionMs)} of ${formatClock(player.durationMs)}`} min={0} max={player.durationMs} step={100} value={player.positionMs} onChange={(event) => player.seek(Number(event.target.value))} className="mt-3 block w-full cursor-pointer accent-primary" />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
              <label className="flex items-center gap-2"><input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} /> Follow transcript</label>
              <label className="flex items-center gap-2">Volume <input type="range" aria-label="Playback volume" min={0} max={1} step={0.05} value={player.volume} onChange={(event) => player.setVolume(Number(event.target.value))} className="w-24 accent-primary" /></label>
            </div>
          </section>
        ) : null}

        <div className="mt-8 flex flex-wrap items-center gap-2">
          <h2 className="mr-auto font-semibold">Transcript</h2>
          <button type="button" className={OUTLINE_BUTTON} disabled={cleaning !== null || recording.status !== "done" || recording.pendingCount > 0 || recording.failedCount > 0 || !recording.wordCount || hasCleaned} onClick={() => void cleanUp()}>
            {cleaning !== null ? <Icon name="Loading" className="animate-spin motion-reduce:animate-none" /> : null} {cleaning !== null ? "Cleaning…" : hasCleaned ? "Cleanup saved" : "Clean up transcript"}
          </button>
          <button type="button" className={OUTLINE_BUTTON} disabled={!transcript} onClick={() => openNewItemThread(navigate, { title: recording.title, href: recordingHref(recording.id) })}><Icon name="MessageSquarePlus" /> Send to agent</button>
        </div>
        {cleaning !== null ? <p role="status" className="mt-2 text-sm text-muted-foreground">{cleaning}</p> : null}
        {hasCleaned ? (
          <div className="mt-3 flex items-center gap-2 text-sm">
            <button type="button" aria-pressed={showCleaned} className={showCleaned ? OUTLINE_BUTTON : GHOST_BUTTON} onClick={() => setVersion("cleaned")}>Cleaned</button>
            <button type="button" aria-pressed={!showCleaned} className={!showCleaned ? OUTLINE_BUTTON : GHOST_BUTTON} onClick={() => setVersion("original")}>Original</button>
            <span className="text-xs text-muted-foreground">Original text and audio kept</span>
          </div>
        ) : null}
        {segments.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">{activeHere ? "Text appears here as each piece is transcribed." : "This recording has no audio."}</p>
        ) : (
          <div ref={transcriptRows} className="mt-4 flex flex-col gap-3">
            {shownSegments.map((segment) => (
              <section key={segment.id} aria-current={player.segmentId === segment.id ? "true" : undefined} className={cn("flex scroll-mt-40 gap-3 rounded px-2 py-2", player.segmentId === segment.id && "bg-primary/10")}>
                {recording.audioRemoved ? (
                  <span className="mt-0.5 shrink-0 font-mono text-xs leading-6 tabular-nums text-muted-foreground">{formatClock(segment.offsetMs)}</span>
                ) : (
                  <button type="button" onClick={() => player.seek(segment.offsetMs, true)} className="mt-0.5 h-6 shrink-0 rounded px-1 font-mono text-xs tabular-nums text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline focus-visible:outline-2" aria-label={`Play from ${formatClock(segment.offsetMs)}`} title="Play from here">{formatClock(segment.offsetMs)}</button>
                )}
                <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[15px] leading-relaxed">
                  <SegmentText segment={segment} onPlay={recording.audioRemoved ? undefined : () => player.seek(segment.offsetMs, true)} />
                </p>
              </section>
            ))}
          </div>
        )}
      </PageColumn>
    </div>
  );
}

/** Without `onPlay` (the audio is gone) the text is plain. */
function SegmentText({ segment, onPlay }: { segment: Segment; onPlay?: () => void }) {
  const at = formatClock(segment.offsetMs);
  if (segment.status === "empty") return <span className="text-sm text-muted-foreground">No speech detected</span>;
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
  if (!onPlay) return <span>{segment.text} </span>;
  return (
    <button
      type="button"
      onClick={onPlay}
      title={`${at} — play`}
      className="cursor-pointer rounded-sm text-left hover:bg-state-hover focus-visible:outline focus-visible:outline-2"
    >
      {segment.text}{" "}
    </button>
  );
}

export function RecordingsPanel({ subPath }: PluginNavPanelProps) {
  const id = subPath.split("/")[0] ?? "";
  if (id === UNSENT_PATH) return <UnsentAudio />;
  return /^rec_[a-z0-9]{8,32}$/.test(id) ? <RecordingDetail id={id} /> : <RecordingList />;
}
