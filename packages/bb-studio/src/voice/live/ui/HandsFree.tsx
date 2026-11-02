// Hands-free voice on the desktop, in the same UI language as the iPhone: a
// talking orb that moves while either side speaks, the words streaming under
// it like subtitles, "Waiting for your yes" only for destructive actions, End,
// and the model, cost and mic in the header. It's a Studio app overlay (a
// floating panel at the right that stays over every page while the session
// runs), opened from the Bot chat's header and the command palette.
import { useRealtime, useRpc, type PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import { useSyncExternalStore } from "react";
import { ICON_BUTTON } from "../../../kit/app/index";
import { Icon, cn } from "../../../kit/ui";
import { useLive } from "../../../ui/live";
import type { voiceLiveContract } from "../contract";
import { usd, VOICE_LIVE_CHANNEL, type VoiceLiveSignal } from "../shared";
import type { Phase, Speaker, Subtitle, ToolCard } from "./machine";
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

// The window's one panel and session.
type State = { open: boolean; session: LiveSession | null };
let state: State = { open: false, session: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
};
const useStore = () => useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => state);

export function openHandsFree(): void {
  set({ open: true });
}

export function toggleHandsFree(): void {
  if (state.open && !state.session?.machine.isLive) set({ open: false });
  else set({ open: true });
}

function useSession(session: LiveSession) {
  useSyncExternalStore((listener) => session.subscribe(listener), () => session.snapshot);
  return session;
}

/** The Bot chat's header: opens Hands-free. Nothing on other threads. */
export function HandsFreeHeaderAction({ threadId }: PluginThreadHeaderActionProps) {
  const bot = useLive("bot_get", {}, { pollMs: 120_000 }).data?.bot ?? null;
  if (!bot?.threadId || bot.threadId !== threadId) return null;
  return (
    <button type="button" data-testid="handsfree-header" aria-label="Hands-free voice" title="Hands-free voice" className={ICON_BUTTON} onClick={openHandsFree}>
      <Icon name="studio/handsfree" aria-hidden />
    </button>
  );
}

/** The panel, over every page while it's open. */
export function HandsFreeOverlay() {
  const { open, session } = useStore();
  const rpc = useRpc<typeof voiceLiveContract>();
  if (!open) return null;
  const live = session?.machine.isLive ? session : null;
  const begin = () => {
    const next = new LiveSession(liveServer(rpc as unknown as Rpc));
    // Staged runs read the trace to measure barge-in and turns.
    (globalThis as { __studioVoiceLive?: LiveSession }).__studioVoiceLive = next;
    set({ session: next });
    next.start();
  };
  return session ? <Panel session={session} onStart={begin} onClose={() => { live?.stop(); set({ open: false }); }} /> : <Panel session={null} onStart={begin} onClose={() => set({ open: false })} />;
}

function Panel({ session, onStart, onClose }: { session: LiveSession | null; onStart: () => void; onClose: () => void }) {
  if (session) return <LivePanel session={session} onStart={onStart} onClose={onClose} />;
  return <PanelFrame speaker={null} header={<Header model="gpt-live-1" costUsd={null} mic="" onClose={onClose} />}><Body phase={{ kind: "idle" }} speaker={null} subtitle={null} card={null} confirmation={null} live={false} connecting={false} onStart={onStart} onStop={() => {}} /></PanelFrame>;
}

function LivePanel({ session, onStart, onClose }: { session: LiveSession; onStart: () => void; onClose: () => void }) {
  useSession(session);
  const { machine } = session;
  useRealtime(VOICE_LIVE_CHANNEL, (payload) => {
    const signal = payload as VoiceLiveSignal;
    if (signal?.kind === "reply") void session.pickUp();
  });
  return (
    <PanelFrame speaker={machine.speaking} header={<Header model={session.model} costUsd={session.costUsd} mic={session.micLabel} onClose={onClose} />}>
      <Body phase={machine.phase} speaker={machine.speaking} subtitle={machine.subtitle} card={machine.card} confirmation={machine.confirmation}
        live={machine.isLive} connecting={machine.phase.kind === "connecting"} onStart={onStart} onStop={() => session.stop()} />
    </PanelFrame>
  );
}

const TINT: Record<Speaker | "thinking" | "idle", string> = {
  user: "from-teal-400 to-teal-600",
  agent: "from-orange-500 to-red-600",
  thinking: "from-fuchsia-500 to-purple-600",
  idle: "from-zinc-400 to-zinc-500",
};

function PanelFrame({ speaker, header, children }: { speaker: Speaker | null; header: React.ReactNode; children: React.ReactNode }) {
  return (
    <div role="dialog" aria-label="Hands-free voice" data-testid="handsfree-panel"
      className="fixed right-4 top-16 bottom-4 z-50 flex w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-border bg-background text-foreground shadow-2xl">
      <div aria-hidden className={cn("pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b to-transparent transition-colors duration-300",
        speaker === "user" ? "from-teal-500/10" : speaker === "agent" ? "from-orange-500/10" : "from-transparent")} />
      {header}
      {children}
    </div>
  );
}

function Header({ model, costUsd, mic, onClose }: { model: string; costUsd: number | null; mic: string; onClose: () => void }) {
  const detail = [model, ...(costUsd != null ? [usd(costUsd)] : []), ...(mic ? [mic] : [])].join(" · ");
  return (
    <div className="relative flex items-center gap-3 px-5 pt-4">
      <div className="min-w-0 flex-1">
        <div className="text-base font-semibold">Hands-free</div>
        <div className="truncate text-xs tabular-nums text-muted-foreground" data-testid="handsfree-detail">{detail}</div>
      </div>
      <button type="button" aria-label="Close" title="Close" className={cn(ICON_BUTTON, "rounded-full")} onClick={onClose}>
        <Icon name="X" aria-hidden />
      </button>
    </div>
  );
}

const STATUS = (phase: Phase): string => {
  switch (phase.kind) {
    case "idle": return "Click Start, then just talk";
    case "connecting": return "Connecting…";
    case "listening": return "Listening";
    case "userSpeaking": return "You";
    case "thinking": return "Thinking…";
    case "agentSpeaking": return "Voice";
    case "paused": return phase.why;
    case "ended": return phase.why ?? "Ended";
    case "failed": return phase.why;
  }
};

function Body(props: { phase: Phase; speaker: Speaker | null; subtitle: Subtitle | null; card: ToolCard | null; confirmation: string | null; live: boolean; connecting: boolean; onStart: () => void; onStop: () => void }) {
  const { phase, speaker, subtitle, card, confirmation, live, connecting } = props;
  return (
    <div className="relative flex min-h-0 flex-1 flex-col items-center px-6">
      <div className="flex-1" />
      <Orb speaker={speaker} thinking={phase.kind === "thinking"} />
      <div className="mt-4 text-sm font-medium text-muted-foreground" data-testid="handsfree-status" aria-live="polite">{STATUS(phase)}</div>
      <SubtitleLine subtitle={subtitle} />
      {card?.kind === "sent" ? (
        <div className="mt-1.5 flex items-center gap-1.5 text-sm font-medium text-muted-foreground" data-testid="handsfree-sent"><Icon name="Check" className="size-4" aria-hidden />{card.title}</div>
      ) : null}
      <div className="flex-1" />
      <div className="flex w-full flex-col gap-2.5">
        {confirmation ? <ConfirmCard question={confirmation} /> : null}
        {card && card.kind !== "sent" ? <Card card={card} /> : null}
      </div>
      <button type="button" data-testid={live ? "handsfree-end" : "handsfree-start"} disabled={connecting} onClick={live ? props.onStop : props.onStart}
        className={cn("my-6 flex size-24 flex-col items-center justify-center gap-1 rounded-full text-white shadow-lg transition-opacity disabled:opacity-60",
          live ? "bg-red-500 hover:bg-red-600" : "bg-orange-600 hover:bg-orange-700")}>
        <Icon name={live ? "studio/phone-off" : "Mic"} className="size-7" aria-hidden />
        <span className="text-xs font-semibold">{live ? "End" : "Start"}</span>
      </button>
    </div>
  );
}

/** Rings and bars that move while someone talks: teal for you, the accent for the voice. */
function Orb({ speaker, thinking }: { speaker: Speaker | null; thinking: boolean }) {
  const active = !!speaker;
  const tint = TINT[speaker ?? (thinking ? "thinking" : "idle")];
  const ring = speaker === "user" ? "border-teal-400" : speaker === "agent" ? "border-orange-400" : thinking ? "border-fuchsia-400" : "border-zinc-300 dark:border-zinc-600";
  return (
    <div className="relative flex size-40 items-center justify-center" data-testid="handsfree-orb" data-speaker={speaker ?? (thinking ? "thinking" : "idle")}
      aria-label={speaker === "user" ? "You're talking" : speaker === "agent" ? "The voice is talking" : "Quiet"} role="img">
      <style>{`
        @keyframes hf-ring { from { transform: scale(.62); opacity: .55 } to { transform: scale(1); opacity: 0 } }
        @keyframes hf-bar { 0%, 100% { transform: scaleY(.35) } 50% { transform: scaleY(1) } }
        @keyframes hf-breathe { 0%, 100% { transform: scale(1) } 50% { transform: scale(1.04) } }
        @media (prefers-reduced-motion: reduce) { .hf-anim { animation: none !important } }
      `}</style>
      {[0, 1, 2].map((index) => (
        <span key={index} className={cn("hf-anim absolute inset-0 rounded-full border-[3px]", ring, active ? "" : "opacity-20")}
          style={active ? { animation: `hf-ring 1.25s ease-out ${index * 0.42}s infinite` } : { transform: `scale(${0.7 + index * 0.1})` }} />
      ))}
      <span className={cn("hf-anim relative flex size-[104px] items-center justify-center rounded-full bg-gradient-to-b shadow-inner", tint)}
        style={thinking ? { animation: "hf-breathe 1.6s ease-in-out infinite" } : undefined}>
        <span className="flex h-12 items-center gap-1.5">
          {[0.75, 0.9, 1, 0.9, 0.75].map((weight, index) => (
            <span key={index} className="hf-anim w-[7px] rounded-full bg-white"
              style={{ height: `${Math.round((active ? 46 : 12) * (active ? weight : 1))}px`, animation: active ? `hf-bar ${0.5 + index * 0.07}s ease-in-out ${index * 0.09}s infinite` : undefined }} />
          ))}
        </span>
      </span>
    </div>
  );
}

/** The current line, streaming; long lines keep their newest words in view. */
function SubtitleLine({ subtitle }: { subtitle: Subtitle | null }) {
  const words = subtitle?.text ?? "";
  const text = words.length > 160 ? `…${words.slice(-160).replace(/^\S*\s/, "")}` : words;
  return (
    <p data-testid="handsfree-subtitle" data-speaker={subtitle?.speaker ?? ""}
      className={cn("mt-3 min-h-[5.5rem] max-w-full text-center text-xl leading-snug", subtitle?.speaker === "user" ? "text-muted-foreground" : "font-medium")}>
      {text}
    </p>
  );
}

/** Only for what's destructive or hard to undo: the question, and how to answer. */
function ConfirmCard({ question }: { question: string }) {
  return (
    <div data-testid="handsfree-confirm" className="rounded-2xl border border-orange-500/35 bg-orange-500/10 p-4">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-orange-600 dark:text-orange-400"><Icon name="AlertTriangle" className="size-3.5" aria-hidden />Waiting for your yes</div>
      <div className="mt-1.5 text-[15px] font-medium leading-snug">{question}</div>
      <div className="mt-1 text-xs text-muted-foreground">Say “yes”, or “no”.</div>
    </div>
  );
}

const CARD_ICON: Record<ToolCard["kind"], string> = { waiting: "ListTodo", sent: "Check", loop: "CircleCheck", reply: "MessageSquare", notice: "AlertCircle" };

function Card({ card }: { card: ToolCard }) {
  return (
    <div data-testid="handsfree-card" className="flex items-start gap-3 rounded-2xl bg-muted/70 p-3.5">
      <Icon name={CARD_ICON[card.kind]} className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <div className="text-sm font-semibold">{card.title}</div>
        {card.detail ? <div className="line-clamp-3 text-xs text-muted-foreground">{card.detail}</div> : null}
      </div>
    </div>
  );
}
