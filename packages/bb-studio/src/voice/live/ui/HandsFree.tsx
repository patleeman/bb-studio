// Hands-free voice on the desktop. A session is its own thread, so it isn't
// tied to the composer it started from: the composer's waveform button
// (beside the mic) starts it, and from then on a small
// floating pill stays over every page and thread until End. The pill, like
// Talk's dictation pill (draggable, its own remembered spot), shows the
// talking orb, the current subtitle line, "✓ Sent to …" and End. It expands
// by itself for a destructive action's "yes" question, and on demand for the
// transcript and a link to the session's voice thread.
import { useBbNavigate, useComposer, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useState, useSyncExternalStore } from "react";
import { COMPOSER_BUTTON, ICON_BUTTON } from "../../../kit/app/index";
import { Icon, cn } from "../../../kit/ui";
import { useDraggable } from "../../../talk/ui/draggable";
import type { voiceLiveContract } from "../contract";
import { HANDSFREE_START_EVENT, usd, VOICE_LIVE_CHANNEL, type VoiceLiveSignal } from "../shared";
import type { Phase, Speaker, ToolCard } from "./machine";
import { HandsFreeQuickSettings } from "./QuickSettings";
import { LiveSession, type LiveServer } from "./session";

type Rpc = { call(method: string, input: unknown): Promise<unknown> };

/** Studio's voiceLive.* RPCs as the session's server. */
export function liveServer(rpc: Rpc): LiveServer {
  return {
    state: async () => (await rpc.call("voiceLive.state", {})) as never,
    start: async (input) => (await rpc.call("voiceLive.start", input)) as never,
    tool: async (input) => (await rpc.call("voiceLive.tool", input)) as never,
    event: async (input) => (await rpc.call("voiceLive.event", input)) as never,
    poll: async (input) => (await rpc.call("voiceLive.poll", input)) as never,
    end: async (input) => (await rpc.call("voiceLive.end", input)) as never,
  };
}

// The window's one session, and whether its pill is expanded.
type State = { session: LiveSession | null; expanded: boolean };
let state: State = { session: null, expanded: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
};
const useStore = () => useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => state);
/** The pill keeps Studio's RPC client, so the command palette can start a session too. */
let windowRpc: Rpc | null = null;

/**
 * Starts a session, or, when one is running, opens its pill. It speaks as the
 * thread it's launched from (docs/voice/identity.md); none: the Chief of Staff.
 */
export function startHandsFree(rpc: Rpc | null = windowRpc, threadId: string | null = null): void {
  if (state.session?.machine.isLive) return set({ expanded: true });
  if (!rpc) return;
  const session = new LiveSession(liveServer(rpc), { threadId });
  // Staged runs read the trace to measure barge-in and turns.
  (globalThis as { __studioVoiceLive?: LiveSession }).__studioVoiceLive = session;
  set({ session, expanded: false });
  session.start();
}

function useSession(session: LiveSession | null) {
  useSyncExternalStore((listener) => session?.subscribe(listener) ?? (() => {}), () => session?.snapshot ?? 0);
}

/** The mic's own ghost button; while a session is live, only the glyph takes the accent. */
export const handsFreeButtonClass = (live: boolean) =>
  cn(COMPOSER_BUTTON, live && "text-orange-600 hover:text-orange-600 dark:text-orange-400 dark:hover:text-orange-400");

/**
 * The composer's waveform button: starts a session (or opens the running
 * one's pill). BB renders plugin composer actions just before its mic, in
 * registration order, so app.tsx registers this last: Expand, waveform, mic, send.
 */
export function HandsFreeComposerButton() {
  const composer = useComposer();
  const rpc = useRpc<typeof voiceLiveContract>();
  const { session } = useStore();
  useSession(session);
  if (composer.scope.kind !== "thread") return null;
  const live = !!session?.machine.isLive;
  const label = live ? "Hands-free voice is on" : "Hands-free voice";
  // Right-click: the next session's model, voice and backend, and this month's spend (QuickSettings.tsx).
  return (
    <HandsFreeQuickSettings live={live}>
      <button type="button" data-testid="handsfree-composer" aria-label={label} title={label} aria-pressed={live}
        className={handsFreeButtonClass(live)}
        onClick={() => startHandsFree(rpc as unknown as Rpc, composer.scope.kind === "thread" ? composer.scope.threadId : null)}>
        <Icon name="studio/handsfree" className="size-4" aria-hidden />
      </button>
    </HandsFreeQuickSettings>
  );
}

// BB's page header is a window drag region in the desktop app; the pill opts out, as Talk's does.
const NO_DRAG = "[app-region:no-drag] [-webkit-app-region:no-drag]";

const STATUS = (phase: Phase): string => {
  switch (phase.kind) {
    case "idle": return "Hands-free";
    case "connecting": return "Connecting…";
    case "listening": return "Listening";
    case "userSpeaking": return "Listening";
    case "thinking": return "Thinking…";
    case "agentSpeaking": return "";
    case "paused": return phase.why;
    case "ended": return phase.why ?? "Ended";
    case "failed": return phase.why;
  }
};

/** The floating pill, over every page while a session runs (and after it ends, until closed). */
export function HandsFreePill() {
  const { session, expanded } = useStore();
  const rpc = useRpc<typeof voiceLiveContract>();
  windowRpc = rpc as unknown as Rpc;
  // Another plugin's page (the Canvas plugin) starts a session speaking for
  // one of its threads with a window event, as Talk's dictation fields do.
  useEffect(() => {
    const start = (event: Event) => {
      const threadId = (event as CustomEvent<{ threadId?: unknown }>).detail?.threadId;
      startHandsFree(rpc as unknown as Rpc, typeof threadId === "string" && threadId ? threadId : null);
    };
    window.addEventListener(HANDSFREE_START_EVENT, start);
    return () => window.removeEventListener(HANDSFREE_START_EVENT, start);
  }, [rpc]);
  if (!session) return null;
  return <Pill key={session.trace[0]?.at ?? 0} session={session} expanded={expanded} />;
}

/** Bottom right, above the composer's row: x is the right edge, y leaves room for the composer. */
export const HANDSFREE_PILL_START = { x: 1, y: 0.8 };

function Pill({ session, expanded }: { session: LiveSession; expanded: boolean }) {
  useSession(session);
  const navigate = useBbNavigate();
  // Starts bottom right, just above the composer; remembered once dragged.
  const drag = useDraggable<HTMLDivElement>("bb-plugin-studio:handsfree-pill-position", HANDSFREE_PILL_START);
  const { machine } = session;
  useRealtime(VOICE_LIVE_CHANNEL, (payload) => {
    const signal = payload as VoiceLiveSignal;
    if (signal?.kind === "reply") void session.pickUp();
  });
  const live = machine.isLive;
  const speaker = machine.speaking;
  // A destructive action's question opens the pill by itself, and closes it again once answered.
  const open = expanded || !!machine.confirmation;
  const subtitle = machine.subtitle;
  const sent = machine.card?.kind === "sent" ? machine.card : null;
  const status = STATUS(machine.phase);
  const line = live && subtitle?.text && (speaker || machine.phase.kind === "thinking" || machine.phase.kind === "listening") ? subtitle : null;
  const detail = [session.model, ...(session.costUsd != null ? [usd(session.costUsd)] : []), ...(session.micLabel ? [session.micLabel] : [])].join(" · ");
  return (
    <div ref={drag.ref} style={drag.style} role="region" aria-label="Hands-free voice" data-testid="handsfree-pill" data-open={open ? "" : undefined}
      className={cn(NO_DRAG, "z-[70] flex w-[calc(100vw-16px)] max-w-[460px] flex-col overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-xl sm:w-[440px]", drag.dragging && "shadow-2xl")}>
      <div {...drag.handleProps} title="Drag to move" className={cn("flex touch-none select-none items-center gap-2.5 py-1.5 pl-1.5 pr-1.5", drag.dragging ? "cursor-grabbing" : "cursor-grab")}>
        <MiniOrb speaker={speaker} thinking={machine.phase.kind === "thinking"} live={live} />
        <div className="min-w-0 flex-1" aria-live="polite">
          {session.identity ? <div data-testid="handsfree-identity" title={`Talking with ${session.identity.name}`} className="truncate text-[11px] font-semibold leading-4 text-foreground/80">{session.identity.label}</div> : null}
          {line ? (
            <div data-testid="handsfree-subtitle" data-speaker={line.speaker} className={cn("truncate text-[13px] leading-5", line.speaker === "user" ? "text-muted-foreground" : "font-medium")}>{tail(line.text)}</div>
          ) : (
            <div data-testid="handsfree-status" className="truncate text-[13px] leading-5 text-muted-foreground">{status || "Voice"}</div>
          )}
          {sent ? <div data-testid="handsfree-sent" className="flex items-center gap-1 truncate text-[11px] leading-4 font-medium text-emerald-600 dark:text-emerald-400"><Icon name="Check" className="size-3 shrink-0" aria-hidden />{sent.title}</div> : null}
        </div>
        <button type="button" data-testid="handsfree-expand" aria-expanded={open} aria-label={open ? "Hide the transcript" : "Show the transcript"} title={open ? "Hide the transcript" : "Show the transcript"}
          className={cn(ICON_BUTTON, "rounded-full")} onClick={() => set({ expanded: !expanded })}>
          <Icon name={open ? "ChevronUp" : "ChevronDown"} aria-hidden />
        </button>
        {live ? (
          <button type="button" data-testid="handsfree-end" aria-label="End hands-free" title="End"
            className="flex h-8 items-center gap-1 rounded-full bg-red-500 px-3 text-xs font-semibold text-white hover:bg-red-600" onClick={() => session.stop()}>
            <Icon name="studio/phone-off" className="size-3.5" aria-hidden />End
          </button>
        ) : (
          <button type="button" data-testid="handsfree-close" aria-label="Close" title="Close" className={cn(ICON_BUTTON, "rounded-full")} onClick={() => set({ session: null, expanded: false })}>
            <Icon name="X" aria-hidden />
          </button>
        )}
      </div>
      {open ? (
        <div className="flex flex-col gap-2.5 border-t border-border px-3 pb-3 pt-2.5">
          {machine.confirmation ? <ConfirmCard question={machine.confirmation} /> : null}
          {expanded ? (
            <>
              <div className="text-[11px] tabular-nums text-muted-foreground" data-testid="handsfree-detail">{detail}</div>
              <Transcript lines={machine.lines} />
              {machine.card && machine.card.kind !== "sent" ? <Card card={machine.card} /> : null}
              <button type="button" data-testid="handsfree-thread" disabled={!session.voiceThreadId}
                className="flex items-center gap-1.5 self-start rounded-md text-xs font-medium text-foreground underline-offset-2 hover:underline disabled:text-muted-foreground disabled:no-underline"
                onClick={() => { if (session.voiceThreadId) navigate.toThread(session.voiceThreadId); }}>
                <Icon name="MessageSquare" className="size-3.5" aria-hidden />{session.voiceThreadId ? "Open the voice thread" : "The voice thread opens in a moment…"}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** A long line's newest words. */
const tail = (text: string) => (text.length > 90 ? `…${text.slice(-90).replace(/^\S*\s/, "")}` : text);

/** The talking orb, small: teal for you, the accent for the voice, purple while thinking. */
function MiniOrb({ speaker, thinking, live }: { speaker: Speaker | null; thinking: boolean; live: boolean }) {
  const active = !!speaker;
  const tint = speaker === "user" ? "from-teal-400 to-teal-600" : speaker === "agent" ? "from-orange-500 to-red-600" : thinking ? "from-fuchsia-500 to-purple-600" : live ? "from-zinc-400 to-zinc-500" : "from-zinc-300 to-zinc-400";
  const ring = speaker === "user" ? "border-teal-400" : speaker === "agent" ? "border-orange-400" : "border-transparent";
  return (
    <span className="relative flex size-9 shrink-0 items-center justify-center" data-testid="handsfree-orb" data-speaker={speaker ?? (thinking ? "thinking" : "idle")}
      role="img" aria-label={speaker === "user" ? "You're talking" : speaker === "agent" ? "The voice is talking" : thinking ? "Thinking" : "Quiet"}>
      <style>{`
        @keyframes hf-ring { from { transform: scale(.7); opacity: .6 } to { transform: scale(1.15); opacity: 0 } }
        @keyframes hf-bar { 0%, 100% { transform: scaleY(.35) } 50% { transform: scaleY(1) } }
        @keyframes hf-breathe { 0%, 100% { transform: scale(1) } 50% { transform: scale(1.06) } }
        @media (prefers-reduced-motion: reduce) { .hf-anim { animation: none !important } }
      `}</style>
      {active ? [0, 1].map((index) => <span key={index} className={cn("hf-anim absolute inset-0 rounded-full border-2", ring)} style={{ animation: `hf-ring 1.2s ease-out ${index * 0.6}s infinite` }} />) : null}
      <span className={cn("hf-anim relative flex size-7 items-center justify-center rounded-full bg-gradient-to-b", tint)} style={thinking ? { animation: "hf-breathe 1.6s ease-in-out infinite" } : undefined}>
        <span className="flex h-3.5 items-center gap-[2px]">
          {[0.7, 1, 0.7].map((weight, index) => (
            <span key={index} className="hf-anim w-[2.5px] rounded-full bg-white"
              style={{ height: `${Math.round((active ? 14 : 5) * (active ? weight : 1))}px`, animation: active ? `hf-bar ${0.45 + index * 0.08}s ease-in-out ${index * 0.1}s infinite` : undefined }} />
          ))}
        </span>
      </span>
    </span>
  );
}

/** Only for what's destructive or hard to undo: the question, and how to answer. */
function ConfirmCard({ question }: { question: string }) {
  return (
    <div data-testid="handsfree-confirm" className="rounded-xl border border-orange-500/35 bg-orange-500/10 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-orange-600 dark:text-orange-400"><Icon name="AlertTriangle" className="size-3.5" aria-hidden />Waiting for your yes</div>
      <div className="mt-1 text-sm font-medium leading-snug">{question}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">Say “yes”, or “no”.</div>
    </div>
  );
}

/** The session so far: both sides' words, newest at the bottom. */
function Transcript({ lines }: { lines: { speaker: Speaker; text: string }[] }) {
  const [list, setList] = useState<HTMLDivElement | null>(null);
  useEffect(() => { if (list) list.scrollTop = list.scrollHeight; }, [list, lines.length]);
  if (!lines.length) return <div className="text-xs text-muted-foreground">Nothing said yet.</div>;
  return (
    <div ref={setList} data-testid="handsfree-transcript" className="flex max-h-56 flex-col gap-1.5 overflow-y-auto pr-1 text-[13px] leading-snug">
      {lines.map((line, index) => (
        <div key={index} className={cn(line.speaker === "user" ? "text-muted-foreground" : "text-foreground")}>
          <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80">{line.speaker === "user" ? "You" : "Voice"}</span>{line.text}
        </div>
      ))}
    </div>
  );
}

const CARD_ICON: Record<ToolCard["kind"], string> = { waiting: "ListTodo", sent: "Check", loop: "CircleCheck", reply: "MessageSquare", notice: "AlertCircle" };

function Card({ card }: { card: ToolCard }) {
  return (
    <div data-testid="handsfree-card" className="flex items-start gap-2.5 rounded-xl bg-muted/70 p-2.5">
      <Icon name={CARD_ICON[card.kind]} className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <div className="text-[13px] font-semibold">{card.title}</div>
        {card.detail ? <div className="line-clamp-2 text-[11px] text-muted-foreground">{card.detail}</div> : null}
      </div>
    </div>
  );
}
