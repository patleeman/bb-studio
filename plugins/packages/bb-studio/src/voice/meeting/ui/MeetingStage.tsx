// The meeting agent's stage: the whole BB window, built for a room that's
// looking at the laptop or a shared screen. Her name and state are large,
// the captions read from across a table, and what she looked up and noted
// stays on the right. Ask, Quiet and End are big enough to hit without
// looking. Minimize shrinks it to a pill so the laptop is usable meanwhile.
import { useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon, cn } from "../../../kit/ui";
import { usd } from "../../live/shared";
import type { meetingContract } from "../contract";
import { MEETING_CHANNEL, type MeetingSignal } from "../shared";
import type { Caption, MeetingController, StageLookup, StageNote } from "./controller";
import { meetingState, setMeetingState, setWindowRpc, startMeeting, subscribeMeeting, type Rpc } from "./store";

const set = setMeetingState;
const useStore = () => useSyncExternalStore(subscribeMeeting, meetingState);

export { startMeeting };

function useMeeting(meeting: MeetingController | null) {
  useSyncExternalStore((listener) => meeting?.subscribe(listener) ?? (() => {}), () => meeting?.snapshot ?? 0);
}

const NO_DRAG = "[app-region:no-drag] [-webkit-app-region:no-drag]";

type Look = "connecting" | "listening" | "hearing" | "thinking" | "speaking" | "quiet" | "ended" | "failed";

function look(meeting: MeetingController, now: number): Look {
  const { machine } = meeting.session;
  switch (machine.phase.kind) {
    case "idle": case "connecting": return "connecting";
    case "ended": return "ended";
    case "failed": return "failed";
    default: break;
  }
  if (meeting.gate.quiet) return "quiet";
  if (machine.speaking === "agent" && meeting.gate.isOpen(now)) return "speaking";
  if (machine.phase.kind === "thinking" && meeting.gate.isOpen(now)) return "thinking";
  if (machine.speaking === "user") return "hearing";
  return "listening";
}

function statusLine(meeting: MeetingController, current: Look, now: number): string {
  const { name } = meeting;
  switch (current) {
    case "connecting": return "Joining…";
    case "speaking": return `${name} is speaking`;
    case "thinking": return "Thinking…";
    case "quiet": return "On Quiet · not answering";
    case "ended": return "The meeting has ended";
    case "failed": return meeting.session.machine.phase.kind === "failed" ? meeting.session.machine.phase.why : "Something went wrong";
    default: {
      const why = meeting.gate.why(now);
      if (why === "name" || why === "follow-up" || why === "ask" || why === "answer") return `${name} is listening to you`;
      return meeting.gate.mode === "judge" ? `Listening · say “${name}” or just ask` : `Listening · say “${name}” to ask`;
    }
  }
}

/** The stage over the whole window, or its pill when minimized. */
export function MeetingStage() {
  const { meeting, minimized, starting } = useStore();
  const rpc = useRpc<typeof meetingContract>();
  setWindowRpc(rpc as unknown as Rpc);
  useMeeting(meeting);
  useRealtime(MEETING_CHANNEL, (payload) => {
    const signal = payload as MeetingSignal;
    if (meeting && signal?.kind === "reply" && signal.sessionId === meeting.session.id) void meeting.answerArrived();
  });
  // Esc minimizes rather than ends: ending is always its own button.
  useEffect(() => {
    if (!meeting || minimized) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") set({ minimized: true }); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [meeting, minimized]);
  if (starting && !meeting) return <Shell><div className="m-auto text-3xl text-white/70">{starting}</div></Shell>;
  if (!meeting) return null;
  if (minimized) return <MeetingPill meeting={meeting} />;
  return <Stage meeting={meeting} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div role="dialog" aria-label="Meeting" data-testid="meeting-stage"
      className={cn(NO_DRAG, "fixed inset-0 z-[80] flex flex-col bg-[#0d0f14] text-white antialiased")}>
      {children}
    </div>
  );
}

function useClock(intervalMs = 500): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

const elapsed = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
};

function Stage({ meeting }: { meeting: MeetingController }) {
  const now = useClock();
  const startedAt = useRef(Date.now()).current;
  const current = look(meeting, now / 1000);
  const live = meeting.session.machine.isLive;
  const { lookups, notes, costUsd } = meeting.view;
  const subtitle = meeting.session.machine.subtitle;
  // The line being said now: the room's words as they come, hers only while heard.
  const partial: Caption | null = subtitle?.text && live
    ? subtitle.speaker === "user" && meeting.session.machine.speaking === "user" ? { speaker: "room", text: subtitle.text }
      : subtitle.speaker === "agent" && current === "speaking" ? { speaker: "agent", text: subtitle.text } : null
    : null;
  return (
    <Shell>
      <header className="flex items-center gap-4 px-8 pt-6">
        <span data-testid="meeting-recording" className="flex items-center gap-2 rounded-full bg-red-500/15 px-4 py-1.5 text-lg font-semibold text-red-300">
          <span className={cn("size-2.5 rounded-full bg-red-500", live && "animate-pulse")} aria-hidden />
          {live ? "Listening to this room" : "Not listening"}
        </span>
        <span className="text-lg tabular-nums text-white/50">{elapsed(now - startedAt)}{costUsd != null ? ` · ${usd(costUsd)}` : ""}</span>
        <div className="flex-1" />
        <button type="button" data-testid="meeting-minimize" onClick={() => set({ minimized: true })}
          className="rounded-full px-4 py-2 text-lg text-white/60 hover:bg-white/10 hover:text-white" title="Minimize (Esc)">
          <Icon name="Minimize2" className="mr-2 inline size-5" aria-hidden />Minimize
        </button>
      </header>
      <main className="flex min-h-0 flex-1 gap-8 px-8 pb-4 pt-6">
        <section className="flex min-w-0 flex-[3] flex-col">
          <Presence meeting={meeting} current={current} now={now / 1000} />
          <Captions captions={meeting.captions} partial={partial} name={meeting.name} />
        </section>
        <aside className="flex min-h-0 w-[min(38vw,560px)] flex-col gap-6 overflow-y-auto pb-2">
          <Lookups lookups={lookups} name={meeting.name} />
          <Notes notes={notes} />
        </aside>
      </main>
      <Controls meeting={meeting} live={live} />
    </Shell>
  );
}

const TINT: Record<Look, string> = {
  connecting: "from-zinc-500 to-zinc-700", listening: "from-sky-500 to-indigo-600", hearing: "from-sky-400 to-indigo-500",
  thinking: "from-fuchsia-500 to-purple-600", speaking: "from-amber-400 to-orange-600", quiet: "from-zinc-600 to-zinc-800",
  ended: "from-zinc-600 to-zinc-800", failed: "from-red-500 to-red-700",
};

/** Her name, large, and an orb that shows whether she's listening, thinking or talking. */
function Presence({ meeting, current, now }: { meeting: MeetingController; current: Look; now: number }) {
  const active = current === "speaking" || current === "hearing";
  return (
    <div className="flex items-center gap-8">
      <style>{`
        @keyframes mt-ring { from { transform: scale(.85); opacity: .55 } to { transform: scale(1.35); opacity: 0 } }
        @keyframes mt-breathe { 0%, 100% { transform: scale(1) } 50% { transform: scale(1.05) } }
        @media (prefers-reduced-motion: reduce) { .mt-anim { animation: none !important } }
      `}</style>
      <div className="relative flex size-40 shrink-0 items-center justify-center" data-testid="meeting-orb" data-look={current}>
        {current === "speaking" ? [0, 1, 2].map((index) => (
          <span key={index} className="mt-anim absolute inset-0 rounded-full border-4 border-amber-400/70" style={{ animation: `mt-ring 1.8s ease-out ${index * 0.6}s infinite` }} />
        )) : null}
        <span className={cn("mt-anim relative flex size-36 items-center justify-center rounded-full bg-gradient-to-br shadow-2xl transition-colors duration-500", TINT[current])}
          style={current === "thinking" || current === "listening" ? { animation: `mt-breathe ${current === "thinking" ? 1.4 : 4}s ease-in-out infinite` } : undefined}>
          <span className={cn("text-7xl font-semibold", active ? "text-white" : "text-white/90")}>{meeting.name.slice(0, 1).toUpperCase()}</span>
        </span>
      </div>
      <div className="min-w-0">
        <h1 data-testid="meeting-name" className="text-8xl font-semibold leading-none tracking-tight">{meeting.name}</h1>
        <p data-testid="meeting-status" aria-live="polite" className="mt-4 text-3xl text-white/70">{statusLine(meeting, current, now)}</p>
      </div>
    </div>
  );
}

/** The last few lines, large; the room's in white, hers in amber with her name. */
function Captions({ captions, partial, name }: { captions: Caption[]; partial: Caption | null; name: string }) {
  const lines = [...captions.slice(partial ? -3 : -4), ...(partial ? [partial] : [])];
  if (!lines.length) {
    return <div className="mt-auto pb-6 text-4xl leading-snug text-white/35">Say “{name}, …” to ask.</div>;
  }
  return (
    <div data-testid="meeting-captions" className="mt-auto flex flex-col gap-5 pb-6" aria-live="polite">
      {lines.map((line, index) => {
        const last = index === lines.length - 1;
        return (
          <p key={`${index}:${line.text.slice(0, 20)}`} data-speaker={line.speaker}
            className={cn("text-4xl leading-snug transition-opacity", line.speaker === "agent" ? "font-medium text-amber-200" : "text-white", !last && "opacity-45")}>
            {line.speaker === "agent" ? <span className="mr-3 text-2xl font-semibold uppercase tracking-wider text-amber-400/80">{name}</span> : null}
            {tail(line.text)}
          </p>
        );
      })}
    </div>
  );
}

const tail = (text: string) => (text.length > 220 ? `…${text.slice(-220).replace(/^\S*\s/, "")}` : text);

function Lookups({ lookups, name }: { lookups: StageLookup[]; name: string }) {
  const navigate = useBbNavigate();
  return (
    <section data-testid="meeting-lookups">
      <h2 className="mb-3 text-xl font-semibold uppercase tracking-wider text-white/45">Looked up</h2>
      {!lookups.length ? <p className="text-2xl text-white/35">“{name}, look up…”</p> : (
        <ol className="flex flex-col gap-3">
          {[...lookups].reverse().slice(0, 4).map((lookup) => (
            <li key={lookup.id} data-status={lookup.status} className={cn("rounded-2xl p-5", lookup.status === "answered" ? "bg-white/10" : "bg-white/5")}>
              <div className="flex items-start gap-3">
                <Icon name={lookup.status === "answered" ? "Search" : lookup.status === "failed" ? "AlertCircle" : "Spinner"} className="mt-1 size-6 shrink-0 text-sky-300" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-xl leading-snug text-white/70">{lookup.question}</p>
                  {lookup.status === "answered" && lookup.answer ? <p className="mt-2 text-2xl leading-snug">{lookup.answer}</p> : null}
                  {lookup.status === "running" ? <p className="mt-1 text-lg text-white/40">Looking it up…</p> : null}
                  {lookup.status === "failed" ? <p className="mt-1 text-lg text-red-300">Couldn't look that up.</p> : null}
                </div>
                {lookup.threadId ? (
                  <button type="button" title="Open the lookup's thread" className="rounded-full p-2 text-white/40 hover:bg-white/10 hover:text-white"
                    onClick={() => { set({ minimized: true }); navigate.toThread(lookup.threadId!); }}>
                    <Icon name="ExternalLink" className="size-5" aria-hidden />
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

const NOTE_LABEL: Record<StageNote["kind"], string> = { decision: "Decision", action: "Action", note: "Note" };
const NOTE_TONE: Record<StageNote["kind"], string> = { decision: "text-emerald-300", action: "text-amber-300", note: "text-white/50" };

function Notes({ notes }: { notes: StageNote[] }) {
  return (
    <section data-testid="meeting-notes">
      <h2 className="mb-3 text-xl font-semibold uppercase tracking-wider text-white/45">Notes</h2>
      {!notes.length ? <p className="text-2xl text-white/35">No notes</p> : (
        <ul className="flex flex-col gap-3">
          {notes.slice(-8).map((note) => (
            <li key={note.id} className="flex gap-3 text-2xl leading-snug">
              <span className={cn("w-24 shrink-0 pt-1 text-base font-semibold uppercase tracking-wider", NOTE_TONE[note.kind])}>{NOTE_LABEL[note.kind]}</span>
              <span>{note.text}{note.owner ? <span className="text-white/50"> · {note.owner}</span> : null}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Controls({ meeting, live }: { meeting: MeetingController; live: boolean }) {
  const quiet = meeting.gate.quiet;
  if (!live) {
    return (
      <footer className="flex items-center justify-center gap-4 px-8 pb-8">
        <button type="button" data-testid="meeting-close" onClick={() => { meeting.dispose(); set({ meeting: null }); }}
          className="rounded-full bg-white/10 px-10 py-5 text-2xl font-semibold hover:bg-white/20">Close</button>
      </footer>
    );
  }
  return (
    <footer className="flex items-center justify-center gap-4 px-8 pb-8">
      <button type="button" data-testid="meeting-ask" onClick={() => meeting.ask()} disabled={quiet}
        className="flex items-center gap-3 rounded-full bg-sky-500 px-10 py-5 text-2xl font-semibold text-white shadow-lg hover:bg-sky-400 disabled:opacity-40">
        <Icon name="Mic" className="size-7" aria-hidden />Ask {meeting.name}
      </button>
      <button type="button" data-testid="meeting-quiet" aria-pressed={quiet} onClick={() => meeting.setQuiet(!quiet)}
        className={cn("flex items-center gap-3 rounded-full px-10 py-5 text-2xl font-semibold", quiet ? "bg-amber-400 text-black hover:bg-amber-300" : "bg-white/10 hover:bg-white/20")}>
        <Icon name={quiet ? "EyeOff" : "Pause"} className="size-7" aria-hidden />{quiet ? "Quiet is on" : "Quiet"}
      </button>
      <button type="button" data-testid="meeting-end" onClick={() => meeting.stop()}
        className="flex items-center gap-3 rounded-full bg-red-600 px-10 py-5 text-2xl font-semibold text-white hover:bg-red-500">
        <Icon name="studio/phone-off" className="size-7" aria-hidden />End meeting
      </button>
    </footer>
  );
}

/** Minimized: a pill bottom right with her state; click to bring the stage back. */
function MeetingPill({ meeting }: { meeting: MeetingController }) {
  const now = useClock(1000);
  const current = look(meeting, now / 1000);
  return (
    <button type="button" data-testid="meeting-pill" onClick={() => set({ minimized: false })}
      className={cn(NO_DRAG, "fixed bottom-24 right-4 z-[80] flex items-center gap-3 rounded-full border border-border bg-popover py-2 pl-2 pr-5 text-popover-foreground shadow-xl")}>
      <span className={cn("flex size-9 items-center justify-center rounded-full bg-gradient-to-br text-lg font-semibold text-white", TINT[current])}>{meeting.name.slice(0, 1).toUpperCase()}</span>
      <span className="text-left">
        <span className="block text-sm font-semibold">{meeting.name}</span>
        <span className="block text-xs text-muted-foreground">{statusLine(meeting, current, now / 1000)}</span>
      </span>
    </button>
  );
}
