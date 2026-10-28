// Recording a call: the source picker (with the one-time notice), the red
// "Recording call" bar that stays on every screen, and the live Me / Them
// transcript on the recording's page. The server runs the capture
// (server/call-capture.ts); this only starts, shows and stops it.
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useRealtime, useRpc, useSettings } from "@get-bb/plugin-sdk/app";
import { openAppPath } from "../../kit/app/index";
import { errorMessage } from "../../kit/format";
import { Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Icon, cn } from "../../kit/ui/index";
import type { CallApp, CallLive, Recording, Segment, TalkRpcContract } from "../shared/contract";
import { CALL_STT_OPTIONS } from "../shared/contract";
import { CALL_LIVE, NEW_CALL_EVENT, formatClock, recordingHref, speakerLabel } from "../shared/format";
import { CONSENT_NOTE, callBarLabel, callTurns, lastSource, rememberSource } from "./call-view";
export { openCallPicker } from "./call-view";

const NO_DRAG = "[app-region:no-drag] [-webkit-app-region:no-drag]";
const SETTINGS_PATH = "/settings/plugins/studio";
const ALL = "all";

/** The live call, from the server and then its realtime updates. */
export function useCallLive(): { live: CallLive | null; consented: boolean | null; refresh(): void } {
  const rpc = useRpc<TalkRpcContract>();
  const [live, setLive] = useState<CallLive | null>(null);
  const [consented, setConsented] = useState<boolean | null>(null);
  const refresh = useCallback(() => {
    rpc.call("recordings.call_status", null).then(
      (status) => {
        setLive(status.active);
        setConsented(status.consented);
      },
      () => {},
    );
  }, [rpc]);
  useEffect(refresh, [refresh]);
  useRealtime(CALL_LIVE, (payload) => {
    const next = (payload as { live?: CallLive | null } | null)?.live;
    if (next !== undefined) setLive(next);
  });
  return { live, consented, refresh };
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function Level({ value, label }: { value: number; label: string }) {
  return (
    <span aria-hidden title={label} className="flex h-3.5 items-end gap-[2px]">
      {[0.5, 0.8, 1].map((weight, i) => (
        <span key={i} className="w-[3px] rounded-full bg-white/90" style={{ height: `${3 + 11 * Math.min(1, value * weight * 1.6)}px`, transition: "height 120ms linear" }} />
      ))}
    </span>
  );
}

function modelText(model: NonNullable<CallLive["model"]>): string {
  return model.stage === "download" && model.progress < 1
    ? `Downloading the transcription model · ${Math.round(model.progress * 100)}%`
    : "Preparing the transcription model…";
}

/** The bar: always on top, on every screen, while a call is recorded. */
export function CallBar({ live, onStop }: { live: CallLive; onStop(): void }) {
  const now = useNow(true);
  const viewing = typeof location !== "undefined" && location.pathname.endsWith(recordingHref(live.recordingId));
  const note = live.error ?? (live.model ? modelText(live.model) : live.fallback ? "Local transcription failed; using BB's voice service." : null);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+8px)] z-[71] flex justify-center px-2">
      <div
        role="status"
        aria-live="polite"
        aria-label="Call recording"
        data-call-bar=""
        className={cn(NO_DRAG, "pointer-events-auto flex max-w-[min(560px,calc(100vw-16px))] flex-col overflow-hidden rounded-xl bg-red-600 text-white shadow-xl")}
      >
        <div className="flex items-center gap-2 py-1 pl-3 pr-1 text-sm">
          <span className={cn("size-2 shrink-0 rounded-full bg-white", live.phase === "recording" && "animate-pulse motion-reduce:animate-none")} />
          <span className="min-w-0 truncate font-medium tabular-nums">{callBarLabel(live, now)}</span>
          {live.phase === "recording" ? <Level value={live.levels.them} label="Them" /> : null}
          {live.phase === "recording" && live.mic ? <Level value={live.levels.me} label="Me" /> : null}
          {!viewing ? (
            <button type="button" className="ml-1 rounded-md px-2 py-1 text-xs font-medium hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white" onClick={() => openAppPath(recordingHref(live.recordingId))}>
              Open
            </button>
          ) : null}
          <button
            type="button"
            disabled={live.phase === "stopping"}
            onClick={onStop}
            className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-xs font-semibold text-red-700 hover:bg-white/90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
          >
            <Icon name="Square" className="size-3" /> Stop
          </button>
        </div>
        {note ? <p className="border-t border-white/20 px-3 py-1 text-xs text-white/90">{note}</p> : null}
      </div>
    </div>
  );
}

function ConsentStep({ onAccept, onCancel, busy }: { onAccept(): void; onCancel(): void; busy: boolean }) {
  const copy = () =>
    void navigator.clipboard.writeText(CONSENT_NOTE).then(() => toast.success("Note copied"), (cause: unknown) => toast.error(errorMessage(cause)));
  return (
    <>
      <DialogHeader>
        <DialogTitle>Before you record a call</DialogTitle>
        <DialogDescription>Recording laws differ by place. In many, everyone on the call has to agree to be recorded.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3 py-2 text-sm">
        <p>Tell the others before you start, and stop if anyone objects. Talk records only the app you choose, and only once you press Start. You can post this note in the call's chat:</p>
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3">
          <p className="min-w-0 flex-1 text-sm">{CONSENT_NOTE}</p>
          <button type="button" aria-label="Copy the note" title="Copy the note" onClick={copy} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-state-hover hover:text-foreground">
            <Icon name="Copy" className="size-4" />
          </button>
        </div>
        <p className="text-muted-foreground">Talk shows this once.</p>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button disabled={busy} onClick={onAccept}>I understand</Button>
      </DialogFooter>
    </>
  );
}

interface Sources {
  supported: boolean;
  reason: string | null;
  permission: "granted" | "denied" | "undetermined" | null;
  apps: CallApp[];
}

function SourceRow({ checked, onSelect, icon, title, detail, badge }: { checked: boolean; onSelect(): void; icon: string; title: string; detail?: string; badge?: string }) {
  return (
    <label className={cn("flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2", checked ? "border-foreground/60 bg-state-active" : "border-border hover:bg-state-hover")}>
      <input type="radio" name="call-source" className="accent-foreground" checked={checked} onChange={onSelect} />
      <Icon name={icon} className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        {detail ? <span className="block truncate text-xs text-muted-foreground">{detail}</span> : null}
      </span>
      {badge ? <span className="shrink-0 rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400">{badge}</span> : null}
    </label>
  );
}

function PickerStep({ onCancel, onStarted }: { onCancel(): void; onStarted(recording: Recording): void }) {
  const rpc = useRpc<TalkRpcContract>();
  const { values } = useSettings();
  const [sources, setSources] = useState<Sources | null>(null);
  const [error, setError] = useState<string | null>(null);
  const remembered = useRef(lastSource());
  const [source, setSource] = useState<string | null>(null);
  const [mic, setMic] = useState(remembered.current?.mic ?? true);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    setError(null);
    rpc.call("recordings.call_sources", null).then((result) => {
      setSources(result);
      setSource((current) => {
        if (current && (current === ALL || result.apps.some((app) => app.bundleId === current))) return current;
        const last = remembered.current?.source;
        if (last && (last === ALL || result.apps.some((app) => app.bundleId === last))) return last;
        return result.apps.find((app) => app.playing)?.bundleId ?? null;
      });
    }, (cause) => setError(errorMessage(cause)));
  }, [rpc]);
  useEffect(load, [load]);
  const stt = typeof values?.callTranscription === "string" ? values.callTranscription : CALL_STT_OPTIONS[0];
  const app = sources?.apps.find((item) => item.bundleId === source);
  const start = async () => {
    if (!source) return;
    setBusy(true);
    try {
      const recording = await rpc.call("recordings.call_start", {
        target: source === ALL ? { all: true } : { bundleIds: [source] },
        app: source === ALL ? "All system audio" : app?.name ?? source,
        mic,
      });
      rememberSource({ source, mic });
      onStarted(recording);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const blocked = sources ? !sources.supported || sources.permission === "denied" : true;
  return (
    <>
      <DialogHeader>
        <DialogTitle>Record a call</DialogTitle>
        <DialogDescription>Pick the app the call is in. Its sound is “Them”, your microphone is “Me”.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3 py-2 text-sm">
        {!sources && !error ? <p className="text-muted-foreground">Looking for apps playing audio…</p> : null}
        {sources && !sources.supported ? <p role="alert" className="text-destructive">{sources.reason ?? "Call capture isn't available here."}</p> : null}
        {sources?.supported ? (
          <div role="radiogroup" aria-label="Call audio source" className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
            {sources.apps.map((item) => (
              <SourceRow key={item.bundleId} checked={source === item.bundleId} onSelect={() => setSource(item.bundleId)} icon="AppWindow" title={item.name} detail={item.bundleId} badge={item.playing ? "Playing" : undefined} />
            ))}
            {sources.apps.length === 0 ? <p className="text-muted-foreground">No app is playing audio. Start the call, then <button type="button" className="underline" onClick={load}>look again</button>.</p> : null}
            <SourceRow checked={source === ALL} onSelect={() => setSource(ALL)} icon="Laptop" title="All system audio" detail="Everything you hear: the call, music, notifications, every browser tab" />
          </div>
        ) : null}
        {sources?.supported ? (
          <label className="flex items-start gap-2">
            <Checkbox checked={mic} onCheckedChange={(next) => setMic(next === true)} aria-label="Record my microphone" className="mt-0.5" />
            <span>
              <span className="block">Record my microphone (“Me”)</span>
              <span className="block text-xs text-muted-foreground">Use headphones, so your mic doesn't pick up the others. Talk also drops what it hears twice.</span>
            </span>
          </label>
        ) : null}
        {sources?.permission === "undetermined" ? <p className="text-xs text-muted-foreground">The first time, macOS asks whether BB may record other apps' audio. Choose Allow.</p> : null}
        {sources?.permission === "denied" ? (
          <p role="alert" className="text-xs text-destructive">BB isn't allowed to record other apps' audio. Allow it in System Settings › Privacy & Security › Screen & System Audio Recording, then look again.</p>
        ) : null}
        {sources?.supported ? (
          <p className="text-xs text-muted-foreground">
            Transcribed with {stt === CALL_STT_OPTIONS[0] ? "WhisperKit on this Mac" : stt === CALL_STT_OPTIONS[1] ? "your home server" : "BB's voice service"}. <button type="button" className="underline hover:text-foreground" onClick={() => openAppPath(SETTINGS_PATH)}>Change in settings</button>
          </p>
        ) : null}
        {error ? <p role="alert" className="text-destructive">{error}</p> : null}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button disabled={busy || blocked || !source} onClick={() => void start()}>
          <Icon name="Mic" className="size-4" /> {busy ? "Starting…" : "Start recording"}
        </Button>
      </DialogFooter>
    </>
  );
}

/** App-wide: the bar while a call records, and the picker when asked for. */
export function CallOverlay() {
  const rpc = useRpc<TalkRpcContract>();
  const { live, consented, refresh } = useCallLive();
  const [open, setOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const lastError = useRef<string | null>(null);
  useEffect(() => {
    const onOpen = () => {
      refresh();
      setOpen(true);
    };
    window.addEventListener(NEW_CALL_EVENT, onOpen);
    return () => window.removeEventListener(NEW_CALL_EVENT, onOpen);
  }, [refresh]);
  // The capture ended with a problem: say so once, after the bar goes.
  useEffect(() => {
    if (live?.error) lastError.current = live.error;
    else if (!live && lastError.current) {
      toast.error(lastError.current);
      lastError.current = null;
    }
  }, [live]);
  const stop = () => {
    if (!live) return;
    void rpc.call("recordings.call_stop", { id: live.recordingId }).then(
      () => toast.success("Call recorded. Talk is finishing the transcript and notes."),
      (cause) => toast.error(errorMessage(cause)),
    );
  };
  const accept = () => {
    setBusy(true);
    void rpc.call("recordings.call_consent", null).then(() => setAccepted(true), (cause) => toast.error(errorMessage(cause))).finally(() => setBusy(false));
  };
  const close = () => setOpen(false);
  return (
    <>
      {live ? <CallBar live={live} onStop={stop} /> : null}
      {open ? (
        <Dialog open onOpenChange={(next) => !next && close()}>
          <DialogContent className="sm:max-w-md">
            {live ? (
              <>
                <DialogHeader>
                  <DialogTitle>A call is being recorded</DialogTitle>
                  <DialogDescription>Talk records one call at a time. Stop {live.app} first.</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="ghost" onClick={close}>Close</Button>
                  <Button onClick={() => { close(); openAppPath(recordingHref(live.recordingId)); }}>Open the recording</Button>
                </DialogFooter>
              </>
            ) : consented === false && !accepted ? (
              <ConsentStep busy={busy} onAccept={accept} onCancel={close} />
            ) : consented === null ? (
              <p className="py-4 text-sm text-muted-foreground">Loading…</p>
            ) : (
              <PickerStep onCancel={close} onStarted={(recording) => { close(); refresh(); openAppPath(recordingHref(recording.id)); }} />
            )}
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

/** A call's transcript as Me / Them turns, filling in live. */
export function CallTranscript({ recording, segments, live, onPlay }: {
  recording: Recording;
  segments: readonly Segment[];
  live: CallLive | null;
  onPlay?: (offsetMs: number) => void;
}) {
  const here = live?.recordingId === recording.id ? live : null;
  const turns = callTurns(segments, here?.partials ?? [], here?.startedAt ?? null);
  const echoes = segments.filter((segment) => segment.echo).length;
  const end = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useEffect(() => {
    if (here && following.current) end.current?.scrollIntoView?.({ block: "nearest" });
  }, [here, turns.length, turns.at(-1)?.text]);
  if (!turns.length) {
    return <p className="mt-4 text-sm text-muted-foreground">{here ? "Text appears here a few seconds after each person speaks." : "This call has no transcript."}</p>;
  }
  return (
    <div
      className="mt-4 flex flex-col gap-3"
      aria-label="Call transcript"
      onWheel={() => { following.current = false; }}
    >
      {turns.map((turn) => (
        <section key={turn.key} className="flex gap-3 rounded px-2 py-1.5">
          <div className="flex w-14 shrink-0 flex-col items-start gap-0.5 pt-0.5">
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", turn.speaker === "me" ? "bg-sky-500/15 text-sky-700 dark:text-sky-300" : "bg-violet-500/15 text-violet-700 dark:text-violet-300")}>
              {speakerLabel(turn.speaker)}
            </span>
            {onPlay && turn.segmentId ? (
              <button type="button" onClick={() => onPlay(turn.offsetMs)} className="rounded px-1 font-mono text-xs tabular-nums text-muted-foreground hover:bg-state-hover hover:text-foreground" aria-label={`Play from ${formatClock(turn.offsetMs)}`} title="Play from here">
                {formatClock(turn.offsetMs)}
              </button>
            ) : (
              <span className="px-1 font-mono text-xs tabular-nums text-muted-foreground">{formatClock(turn.offsetMs)}</span>
            )}
          </div>
          <p className={cn("min-w-0 flex-1 whitespace-pre-wrap break-words text-[15px] leading-relaxed", turn.pending && !turn.text && "text-muted-foreground")}>
            {turn.text}
            {turn.pending ? <span className="ml-1 inline-flex translate-y-0.5 items-center text-muted-foreground" title="Transcribing"><Icon name="Loading" className="size-3.5 animate-spin motion-reduce:animate-none" /></span> : null}
            {turn.failed ? <span className="ml-1 text-sm text-destructive">Part of this couldn't be transcribed.</span> : null}
          </p>
        </section>
      ))}
      <div ref={end} />
      {echoes ? <p className="text-xs text-muted-foreground">Hid {echoes === 1 ? "1 piece" : `${echoes} pieces`} where your mic picked up the others.</p> : null}
    </div>
  );
}
