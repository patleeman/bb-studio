// The app-wide recording pill. BB mounts it once per window, outside every
// route, so it stays put while the user moves between threads, and it is the
// component that connects the controller to RPC, settings, and realtime.
import { useEffect, useRef, useState } from "react";
import {
  useBbContext,
  useBbNavigate,
  useRealtime,
  useRpc,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import type { TalkRpcContract } from "../shared/contract";
import { NEW_RECORDING_EVENT, PANEL_PATH, RECORDING_CHANGED, formatClock, tail } from "../shared/format";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { talk, useTalkState, type TalkState } from "./controller";
import { useDraggable } from "./draggable";

// BB's page header is a window drag region in the desktop app, and the OS
// swallows clicks there. The pill opts out, as BB's own popups do.
const NO_DRAG = "[app-region:no-drag] [-webkit-app-region:no-drag]";

/** Keeps the controller attached to this window's SDK contexts. */
function useControllerWiring(): void {
  const rpc = useRpc<TalkRpcContract>();
  const { values } = useSettings();
  const { projectId, threadId } = useBbContext();
  const navigate = useBbNavigate();
  useEffect(() => talk.attach(rpc), [rpc]);
  useEffect(() => talk.setNavigator(navigate), [navigate]);
  useEffect(() => {
    talk.configure({
      segmentSeconds: typeof values?.segmentSeconds === "number" ? values.segmentSeconds : 25,
      replaceBuiltIn: values?.replaceBuiltInDictation !== false,
    });
  }, [values]);
  useEffect(() => talk.setContext({ projectId, threadId }), [projectId, threadId]);
  // Studio's "New recording": start one in the chosen project and open its page.
  useEffect(() => {
    const onNew = (event: Event) => {
      event.preventDefault();
      const detail = (event as CustomEvent<{ projectId?: unknown }>).detail;
      const projectId = typeof detail?.projectId === "string" ? detail.projectId : null;
      void talk.startRecording("recording", null, null, { projectId }).then(() => {
        const { recordingId, phase } = talk.getState();
        if (recordingId && phase !== "idle") navigate.toPluginPanel(PANEL_PATH, { subPath: recordingId });
      });
    };
    window.addEventListener(NEW_RECORDING_EVENT, onNew);
    return () => window.removeEventListener(NEW_RECORDING_EVENT, onNew);
  }, [navigate]);
  useRealtime(RECORDING_CHANGED, (payload) => {
    const id = (payload as { id?: unknown } | null)?.id;
    if (typeof id === "string") void talk.refresh(id);
  });
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

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

/** Five bars driven straight from the analyser, outside React renders. */
function LevelMeter({ live }: { live: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (!live) {
      element.style.setProperty("--talk-level", "0");
      return;
    }
    let frame = 0;
    const draw = () => {
      element.style.setProperty("--talk-level", talk.level().toFixed(3));
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [live]);
  return (
    <span ref={ref} aria-hidden className="flex h-4 items-center gap-[2px]">
      {[0.55, 0.8, 1, 0.8, 0.55].map((weight, i) => (
        <span
          key={i}
          className={cn("w-[3px] rounded-full", live ? "bg-red-500" : "bg-muted-foreground/60")}
          style={{
            height: `calc(3px + 13px * min(1, var(--talk-level, 0) * ${weight * 1.4}))`,
            transition: "height 60ms linear",
          }}
        />
      ))}
    </span>
  );
}

function PillButton({
  icon,
  label,
  onClick,
  tone = "default",
}: {
  icon: string;
  label: string;
  onClick: () => void;
  tone?: "default" | "primary" | "danger";
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring max-sm:size-10",
        tone === "default" && "text-muted-foreground hover:bg-state-hover hover:text-foreground",
        tone === "primary" && "bg-foreground text-background hover:bg-foreground/90",
        tone === "danger" && "bg-red-500 text-white hover:bg-red-600",
      )}
    >
      <Icon name={icon} className="size-4" />
    </button>
  );
}

function statusLabel(state: TalkState, online: boolean): string {
  switch (state.phase) {
    case "starting":
      return "Starting…";
    case "paused":
      return "Paused";
    case "needs-resume":
      return "Microphone stopped";
    case "finalizing":
      return state.pendingUploads > 0 ? `Saving ${state.pendingUploads}…` : "Saving…";
    case "transcribing":
      return "Transcribing…";
    default:
      if (!online) return "Offline · saving locally";
      if (state.pendingUploads > 1) return `${state.pendingUploads} waiting to upload`;
      return state.kind === "dictation" ? "Dictating" : "Recording";
  }
}

export function TalkOverlay() {
  useControllerWiring();
  const state = useTalkState();
  const navigate = useBbNavigate();
  const online = useOnline();
  const [expanded, setExpanded] = useState(false);
  const drag = useDraggable<HTMLDivElement>();
  const capturing = state.phase === "recording";
  // Ticks whenever the pill shows: the clock runs, and the Back button
  // follows the composer on screen.
  const now = useNow(state.phase !== "idle");

  if (state.phase === "idle") {
    if (state.pendingUploads === 0) return null;
    return (
      <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+8px)] z-[70] flex justify-center">
        <div className={cn(NO_DRAG, "pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-popover px-3 py-1.5 text-xs text-muted-foreground shadow-lg")}>
          <Icon name={online ? "Cloud" : "CloudOff"} className="size-3.5" />
          {online ? `Uploading ${state.pendingUploads} saved audio pieces…` : "Offline · audio saved on this device"}
        </div>
      </div>
    );
  }

  const elapsed = state.recordedMs + (state.captureStartedAt ? now - state.captureStartedAt : 0);
  const dictation = state.kind === "dictation";
  const canPause = state.phase === "recording";
  const canResume = state.phase === "paused" || state.phase === "needs-resume";
  const canStop = canPause || canResume || state.phase === "starting";
  const openRecording = () => {
    if (state.recordingId) navigate.toPluginPanel(PANEL_PATH, { subPath: state.recordingId });
  };
  const title = state.recording?.titleSource === "pending" ? null : state.recording?.title;
  const away = !talk.isAtSource();
  const text = state.transcript.trim();

  return (
    <div
      ref={drag.ref}
      role="region"
      aria-label="Talk recording"
      data-talk-overlay=""
      style={drag.style}
      className={cn(
        NO_DRAG,
        "z-[70] flex w-[calc(100vw-16px)] max-w-[420px] flex-col overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-xl sm:w-auto sm:min-w-[300px]",
        drag.dragging && "shadow-2xl",
      )}
    >
      <div
        {...drag.handleProps}
        title="Drag to move"
        className={cn(
          "flex touch-none select-none items-center gap-2 py-1 pl-3 pr-1",
          drag.dragging ? "cursor-grabbing" : "cursor-grab",
        )}
      >
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            capturing ? "animate-pulse bg-red-500 motion-reduce:animate-none" : "bg-muted-foreground/60",
          )}
        />
        <span className="font-mono text-sm tabular-nums">{formatClock(elapsed)}</span>
        <LevelMeter live={capturing} />
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-md px-1 text-left text-xs text-muted-foreground hover:text-foreground"
        >
          <span className="truncate">{statusLabel(state, online)}</span>
          <Icon name={expanded ? "ChevronUp" : "ChevronDown"} className="size-3.5 shrink-0" />
        </button>
        {state.uploadError && online ? (
          <span title={`Upload will retry: ${state.uploadError}`}>
            <Icon name="AlertTriangle" className="size-4 text-amber-500" />
          </span>
        ) : null}
        {away ? (
          <PillButton
            icon="ArrowTurnBackward"
            label={dictation ? "Back to where you're dictating" : "Back to the recording"}
            onClick={() => talk.goToSource()}
          />
        ) : null}
        {canPause ? <PillButton icon="Pause" label="Pause" onClick={() => void talk.pause()} /> : null}
        {canResume ? (
          <PillButton icon="Mic" label="Resume recording" tone="primary" onClick={() => void talk.resume()} />
        ) : null}
        {canStop && dictation ? (
          <>
            <PillButton icon="CircleX" label="Stop without inserting" onClick={() => void talk.stop(false)} />
            <PillButton icon="Check" label="Stop and insert" tone="danger" onClick={() => void talk.stop(true)} />
          </>
        ) : null}
        {canStop && !dictation ? (
          <PillButton icon="Square" label="Stop recording" tone="danger" onClick={() => void talk.stop(false)} />
        ) : null}
        {state.phase === "transcribing" ? (
          <PillButton icon="CircleX" label="Stop waiting; keep it in recordings" onClick={() => talk.dismiss()} />
        ) : null}
      </div>
      {expanded ? (
        <div className="border-t border-border px-3 pb-2 pt-2">
          {title ? <div className="mb-1 truncate text-xs font-medium">{title}</div> : null}
          <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {text === "" ? "Text appears here as each piece is transcribed." : tail(text, 600)}
          </p>
          <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {state.recording
                ? `${state.recording.wordCount} words · ${state.recording.segmentCount} pieces${
                    state.recording.pendingCount > 0 ? ` · ${state.recording.pendingCount} transcribing` : ""
                  }`
                : ""}
            </span>
            <button
              type="button"
              onClick={openRecording}
              className="inline-flex cursor-pointer items-center gap-1 hover:text-foreground"
            >
              Open <Icon name="ArrowUpRight" className="size-3.5" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
