// Voice calls on the desktop: the phone button in a Bot chat's header, and
// the call bar (an app overlay) with the timer, who's speaking, the running
// cost, mute, push-to-talk and End.
import { openAppPath } from "@bb-studio/kit/app";
import { errorMessage } from "@bb-studio/kit/format";
import { Icon, cn } from "@bb-studio/kit/ui";
import { useRealtime, useRpc, type PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { pagePath } from "../../../pages/constants";
import { useLive } from "../../../ui/live";
import type { voiceCallContract, VoiceCallState } from "../contract";
import { callClock, callLength, callUsd, VOICE_CALL_CHANNEL, type VoiceCallSignal } from "../shared";
import type { CallSession, CallSnapshot } from "./session";
import { dismissCall, endCall, hasCallFixture, startCall, useCallState } from "./store";

function useSnapshot(session: CallSession): CallSnapshot {
  return useSyncExternalStore((listener) => session.subscribe(listener), () => session.state);
}

/** The phone button on a Bot's chat; nothing on other threads. */
export function VoiceCallButton({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof voiceCallContract>();
  const live = useLive<VoiceCallState>("voice_call_state", { threadId }, { pollMs: 5 * 60_000 });
  const { call, starting } = useCallState();
  const state = live.data;
  if (!state?.botId) return null;
  const onCall = !!call && call.session.state.status !== "ended";
  const label = onCall ? `On a call with ${call!.botName}` : starting ? "Calling…" : state.ready ? `Call ${state.botName}` : state.problem ?? "Calls aren't available";
  const start = () => {
    if (!state.ready && !hasCallFixture()) return void toast.error(`Can't call ${state.botName}`, { description: state.problem ?? undefined });
    void startCall(rpc as never, state.botId!).then(() => live.refresh(), (error: unknown) => { live.refresh(); toast.error(`Couldn't call ${state.botName}`, { description: errorMessage(error) }); });
  };
  return (
    <button type="button" data-testid="voice-call-button" aria-label={label} title={label} disabled={onCall || starting} onClick={start}
      className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:opacity-60", onCall && "text-emerald-600 dark:text-emerald-400")}>
      <Icon name="studio/phone" className={cn("size-3.5", starting && "animate-pulse motion-reduce:animate-none")} />
      {isCompactViewport ? null : <span>{onCall ? "On call" : "Call"}</span>}
    </button>
  );
}

/** Re-renders each `ms`, for the timer and the level meters. */
function useTick(ms: number, on: boolean) {
  const [, setNow] = useState(0);
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms, on]);
}

/** Five bars from a 0–1 level. */
function Bars({ level, tone }: { level: number; tone: "you" | "voice" | "idle" }) {
  return (
    <span className="flex h-4 items-center gap-[2px]" aria-hidden="true">
      {[0.5, 0.8, 1, 0.8, 0.5].map((weight, index) => (
        <span key={index} className={cn("w-[3px] rounded-full transition-[height] duration-100", tone === "you" ? "bg-red-500" : tone === "voice" ? "bg-sky-500" : "bg-muted-foreground/40")}
          style={{ height: `${Math.max(3, Math.round(16 * Math.min(1, level * 1.6) * weight))}px` }} />
      ))}
    </span>
  );
}

const barButton = "inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The live call bar, top center, over every page while a call is on. */
export function VoiceCallBar() {
  const { call } = useCallState();
  if (!call) return null;
  return <Bar key={call.callId} />;
}

function Bar() {
  const { call } = useCallState();
  const session = call!.session;
  const snapshot = useSnapshot(session);
  const live = snapshot.status === "live";
  useTick(120, live);
  useRealtime(VOICE_CALL_CHANNEL, (payload) => {
    const signal = payload as VoiceCallSignal;
    if (signal?.callId === call!.callId && signal.kind === "reply") void session.pickUp();
  });
  // Push-to-talk: hold Space (outside text fields) as well as the button.
  useEffect(() => {
    if (!snapshot.pushToTalk || !live) return;
    const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    const down = (event: KeyboardEvent) => { if (event.code === "Space" && !event.repeat && !typing(event.target)) { event.preventDefault(); session.pressTalk(); } };
    const up = (event: KeyboardEvent) => { if (event.code === "Space" && !typing(event.target)) { event.preventDefault(); session.releaseTalk(); } };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [snapshot.pushToTalk, live, session]);
  useEffect(() => { if (snapshot.error && live) toast.error("Call", { description: snapshot.error }); }, [snapshot.error, live]);

  const levels = live ? call!.transport.levels() : { mic: 0, voice: 0 };
  const micLive = snapshot.pushToTalk ? snapshot.talking : !snapshot.muted;
  const you = micLive && (snapshot.userSpeaking || levels.mic > 0.12);
  const voice = !you && (levels.voice > 0.04 || snapshot.responding);
  const speaker = you ? "You're talking" : voice ? "Speaking" : snapshot.waiting ? `${call!.botName} is on it` : "Listening";
  const elapsed = (snapshot.record?.endedAt ?? Date.now()) - snapshot.startedAt;

  if (snapshot.status !== "live") {
    const record = snapshot.record;
    return (
      <div role="status" data-testid="voice-call-bar" data-state={snapshot.status}
        className="fixed left-1/2 top-3 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-popover px-4 py-1.5 text-sm text-popover-foreground shadow-lg">
        <Icon name="studio/phone-off" className="size-4 text-muted-foreground" />
        <span>{snapshot.status === "ending" ? "Ending the call…" : record ? `Call · ${callLength(record.durationMs)}${record.costUsd != null ? ` · ≈${callUsd(record.costUsd)}` : ""}` : "Call ended"}</span>
        {record?.pageId ? <button type="button" className={cn(barButton, "bg-muted hover:bg-state-hover")} onClick={() => { openAppPath(pagePath(record.pageId!)); dismissCall(); }}>Transcript</button> : null}
        {snapshot.status === "ended" ? <button type="button" aria-label="Close" className="text-muted-foreground hover:text-foreground" onClick={dismissCall}><Icon name="X" className="size-4" /></button> : null}
      </div>
    );
  }

  return (
    <div role="region" aria-label={`Call with ${call!.botName}`} data-testid="voice-call-bar" data-state="live"
      className="fixed left-1/2 top-3 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-popover py-1 pl-3 pr-1 text-sm text-popover-foreground shadow-lg">
      <span className="relative flex size-2.5" aria-hidden="true">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60 motion-reduce:animate-none" />
        <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
      </span>
      <span className="font-medium">{call!.botName}</span>
      <span className="tabular-nums text-muted-foreground" data-testid="voice-call-timer">{callClock(elapsed)}</span>
      <span className="flex min-w-[9rem] items-center gap-1.5" data-testid="voice-call-speaker" aria-live="polite">
        <Bars level={you ? Math.max(levels.mic, 0.4) : voice ? Math.max(levels.voice, 0.35) : 0} tone={you ? "you" : voice ? "voice" : "idle"} />
        <span className={cn("text-xs", you ? "text-red-600 dark:text-red-400" : voice ? "text-sky-600 dark:text-sky-400" : "text-muted-foreground")}>{speaker}</span>
      </span>
      <span className="tabular-nums text-xs text-muted-foreground" data-testid="voice-call-cost" title="Estimated from OpenAI's usage reports">≈{callUsd(snapshot.costUsd ?? 0)}</span>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
      {snapshot.pushToTalk ? (
        <button type="button" data-testid="voice-call-talk" aria-pressed={snapshot.talking}
          className={cn(barButton, snapshot.talking ? "bg-red-500 text-white" : "bg-muted hover:bg-state-hover")}
          onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); session.pressTalk(); }}
          onPointerUp={() => session.releaseTalk()} onPointerCancel={() => session.releaseTalk()}>
          <Icon name="Mic" className="size-3.5" />{snapshot.talking ? "Talking…" : "Hold to talk"}
        </button>
      ) : (
        <button type="button" data-testid="voice-call-mute" aria-pressed={snapshot.muted} aria-label={snapshot.muted ? "Unmute" : "Mute"} title={snapshot.muted ? "Unmute" : "Mute"}
          className={cn(barButton, "px-2", snapshot.muted ? "bg-amber-500/20 text-amber-700 dark:text-amber-300" : "hover:bg-state-hover")} onClick={() => session.setMuted(!snapshot.muted)}>
          <Icon name={snapshot.muted ? "studio/mic-off" : "Mic"} className="size-4" />
        </button>
      )}
      <button type="button" data-testid="voice-call-ptt" aria-pressed={snapshot.pushToTalk} title={snapshot.pushToTalk ? "Back to hands-free: the call hears you when you talk" : "Push to talk: hold the button (or Space) to talk"}
        className={cn(barButton, snapshot.pushToTalk ? "bg-foreground/10" : "hover:bg-state-hover")} onClick={() => session.setPushToTalk(!snapshot.pushToTalk)}>
        {snapshot.pushToTalk ? "Hands-free" : "Push to talk"}
      </button>
      <button type="button" data-testid="voice-call-end" aria-label="End call" title="End call"
        className={cn(barButton, "bg-red-600 text-white hover:bg-red-700")} onClick={() => void endCall()}>
        <Icon name="studio/phone-off" className="size-4" />End
      </button>
    </div>
  );
}
