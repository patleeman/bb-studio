// Voice mode in BB's own thread view, and the composer's one recording
// surface ("Composer: one recording surface"). A speaker button turns voice
// mode on for the thread; then one spot beside the speaker shows one thing at
// a time, with no words or timer beside it: the hold-to-talk control, your
// voice (a red dot and red bars) or the Bot's (its speaker glyph and blue
// bars, with Stop). Talk's dictation mic stays; one recording runs at a time:
// pressing it ends voice mode's turn and holds voice mode (hands-free too)
// until the dictation is done, and turning voice mode on finishes a dictation. Push-to-talk is the default; a long silent press switches
// to hands-free, and tapping the red pill switches back (voice-input.ts has
// the rules). While you talk, your words stream into the input phrase by
// phrase and are sent when you finish; while the Bot speaks, the piece being
// read lights up in the transcript. New voice chat starts a thread with it on.
import { Icon, Popover, PopoverContent, PopoverTrigger, Tooltip, cn } from "../../kit/ui/index";
import { SpeechSection } from "../../ui/setup/SpeechSection";
import { errorMessage } from "../../kit/format";
import { useBbNavigate, useComposer, useRealtime, useRpc, useSdk, type PluginAppBuilder, type PluginComposerApi } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { talk, useTalkState } from "../../talk/ui/controller";
import type { speechContract } from "../../speech/contract";
import type { voiceContract } from "../contract";
import { VOICE_REALTIME_CHANNEL, type VoiceSpoken } from "../shared";
import { useVoiceSnapshot, voicePlayer } from "./state";
import { HINT_TEXT, INITIAL_INPUT, SpeechGate, footer, reduce, takeHint, wantsCapture, type VoiceEffect, type VoiceEvent, type VoiceInput } from "./voice-input";
import { canRestoreFailedDictation } from "./dictation-recovery";

const NEW_VOICE_CHAT_EVENT = "studio:new-voice-chat";
const TOGGLE_VOICE_EVENT = "studio:toggle-voice";
const BARS = 28;
/** The pill's speed button steps through these. */
export const SPEEDS = [1, 1.25, 1.5, 1.75, 2] as const;

/** The next speed after `speed`, back to 1 after the fastest. */
export function nextSpeed(speed: number): number {
  return SPEEDS.find((each) => each > speed + 0.001) ?? SPEEDS[0];
}

/** Speech's playback speed, shared with Setup → Speech; the pill's button changes it. */
function useSpeechSpeed() {
  const rpc = useRpc<typeof speechContract>();
  const [speed, setSpeed] = useState(1);
  useEffect(() => {
    let live = true;
    rpc.call("speech.state", null).then((state) => {
      if (!live) return;
      setSpeed(state.speed);
      voicePlayer.setRate(state.speed);
    }, () => {});
    return () => { live = false; };
  }, [rpc]);
  const change = useCallback((next: number) => {
    setSpeed(next);
    voicePlayer.setRate(next);
    rpc.call("speech.update", { speed: next }).catch((error: unknown) => toast.error("Couldn't save the speed", { description: errorMessage(error) }));
  }, [rpc]);
  /** The speed was saved elsewhere (the voice menu): just follow it. */
  const follow = useCallback((next: number) => {
    setSpeed(next);
    voicePlayer.setRate(next);
  }, []);
  return { speed, change, follow };
}

const ACTION_BUTTON =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4";

/** A thread's voice mode, read once and kept in step with the other controls. */
function useVoiceMode(threadId: string) {
  const rpc = useRpc<typeof voiceContract>();
  const { on } = useVoiceSnapshot();
  const [conversational, setConversationalState] = useState(true);
  useEffect(() => {
    let live = true;
    rpc.call("voice.state", { threadId }).then((state) => {
      if (!live) return;
      voicePlayer.setOn(threadId, state.on);
      setConversationalState(state.conversational);
    }, () => {});
    return () => { live = false; };
  }, [rpc, threadId]);
  const setConversational = useCallback(async (next: boolean) => {
    setConversationalState(next);
    try {
      setConversationalState((await rpc.call("voice.conversational", { threadId, on: next })).conversational);
    } catch (error) {
      setConversationalState(!next);
      toast.error("Couldn't change that", { description: errorMessage(error) });
    }
  }, [rpc, threadId]);
  const set = useCallback(async (next: boolean) => {
    voicePlayer.setOn(threadId, next);
    try {
      const state = await rpc.call("voice.set", { threadId, on: next });
      voicePlayer.setOn(threadId, state.on);
      if (state.on && state.speechProblem) toast.info("Voice mode is on, but replies can't be spoken yet", { description: `${state.speechProblem} Set it up in Studio → Setup → Speech.` });
    } catch (error) {
      voicePlayer.setOn(threadId, !next);
      toast.error("Couldn't change voice mode", { description: errorMessage(error) });
    }
  }, [rpc, threadId]);
  return { on: on[threadId] ?? false, set, conversational, setConversational };
}

/** Beside the mic: voice mode and its pill in a thread; New voice chat in a new thread's composer. */
function VoiceControls() {
  const composer = useComposer();
  const scope = composer.scope;
  if (scope.kind === "thread") return <ThreadVoiceControls composer={composer} threadId={scope.threadId} />;
  if (scope.kind === "new-thread") {
    return (
      <Tooltip label="New voice chat" side="top">
        <button type="button" aria-label="New voice chat" className={ACTION_BUTTON} onClick={() => newVoiceChat(scope.projectId)}>
          <Icon name="studio/talk" className="size-4" />
        </button>
      </Tooltip>
    );
  }
  return null;
}

/** Screenshots and tests set a voice state without a microphone or a reply: `{ threadId, state }`, state null to clear. */
export const VOICE_FIXTURE_EVENT = "studio:voice-fixture";
type Fixture = "listening-ptt" | "listening-hands-free" | "speaking" | "hint";
const FIXTURES: readonly Fixture[] = ["listening-ptt", "listening-hands-free", "speaking", "hint"];
const HINT_SHOWS_MS = 8000;

const inputLevel = () => talk.level();
const outputLevel = () => voicePlayer.level();
/** A believable level for a fixture's meter. */
const fixtureLevel = () => 0.3 + 0.45 * Math.abs(Math.sin(performance.now() / 170) * Math.cos(performance.now() / 410));

function ThreadVoiceControls({ composer, threadId }: { composer: PluginComposerApi; threadId: string }) {
  const { on, set, conversational, setConversational } = useVoiceMode(threadId);
  const voiceRpc = useRpc<typeof voiceContract>();
  const rpcRef = useRef(voiceRpc);
  rpcRef.current = voiceRpc;
  const { speed, change: changeSpeed, follow: followSpeed } = useSpeechSpeed();
  const snapshot = useVoiceSnapshot();
  const talkState = useTalkState();
  const sdk = useSdk();
  const anchor = useRef<HTMLSpanElement>(null);
  const [fixture, setFixture] = useState<Fixture | null>(null);
  const [input, setInput] = useState<VoiceInput>(INITIAL_INPUT);
  const inputRef = useRef(input);
  const gate = useRef(new SpeechGate());
  const releasedAt = useRef(0);

  const ours = talkState.threadId === threadId && talkState.kind === "dictation" && talkState.voice;
  const capturing = ours && (talkState.phase === "starting" || talkState.phase === "recording");
  const listening = ours && (capturing || talkState.phase === "transcribing");
  const realSpeaking = snapshot.threadId === threadId && snapshot.playing !== "idle";
  const speaking = fixture ? fixture === "speaking" : realSpeaking;
  const capturingRef = useRef(capturing);
  capturingRef.current = capturing;
  const speakingRef = useRef(realSpeaking);
  speakingRef.current = realSpeaking;
  const shown: VoiceInput = fixture === "listening-ptt" ? { sub: "ptt", pressedAt: 0 } : fixture === "listening-hands-free" ? { sub: "hands-free", pressedAt: null } : input;
  const view = footer({ voiceOn: on, state: shown, dictating: talkState.kind === "dictation" && talkState.phase !== "idle" && !talkState.voice, capturing: fixture ? fixture === "listening-ptt" : capturing, speaking });

  const run = useCallback((effect: VoiceEffect) => {
    switch (effect) {
      case "start-capture": {
        const state = talk.getState();
        // The last turn is still being transcribed: it's the one capture Talk has.
        if (state.voice && state.threadId === threadId && state.phase !== "idle") return;
        gate.current.reset();
        void talk.startRecording("dictation", anchor.current?.closest<HTMLElement>("[data-promptbox]") ?? null)
          .catch((error: unknown) => toast.error("Couldn't start listening", { description: errorMessage(error) }))
          .then(() => {
            // It didn't open (no mic, or Talk busy elsewhere): hands-free goes back to push-to-talk rather than retry.
            const state = talk.getState();
            if (state.voice && state.threadId === threadId && state.phase !== "idle") return;
            if (inputRef.current.sub === "hands-free") {
              inputRef.current = INITIAL_INPUT;
              setInput(INITIAL_INPUT);
            }
          });
        return;
      }
      case "send":
        gate.current.reset();
        void talk.stop(true);
        return;
      case "discard":
        gate.current.reset();
        void talk.stop(false);
        return;
      case "finish-dictation":
        void talk.stop(true);
        return;
      case "stop-playback":
        voicePlayer.stop();
        return;
      case "show-hint":
        voicePlayer.setHint(threadId);
        window.setTimeout(() => { if (voicePlayer.hint() === threadId) voicePlayer.setHint(null); }, HINT_SHOWS_MS);
        return;
    }
  }, [threadId]);

  const dispatch = useCallback((event: VoiceEvent) => {
    const state = talk.getState();
    const context = {
      speaking: speakingRef.current,
      capturing: state.voice && state.threadId === threadId && (state.phase === "starting" || state.phase === "recording"),
    };
    const result = reduce(inputRef.current, event, context);
    inputRef.current = result.state;
    setInput(result.state);
    result.effects.forEach(run);
  }, [threadId, run]);

  // Voice mode takes the mic from a dictation, and gives it back when it's off.
  const wasOn = useRef(on);
  useEffect(() => {
    if (wasOn.current === on) return;
    wasOn.current = on;
    dispatch(on ? { type: "voice-on", dictating: talk.isDictating() && !talk.getState().voice } : { type: "voice-off" });
  }, [on, dispatch]);

  // Talk's mic pressed here: voice mode ends its turn and waits for the dictation.
  useEffect(() => {
    if (!on) return;
    return voicePlayer.holdMic(threadId, (dictating) => dispatch(dictating ? { type: "dictation-start", heard: gate.current.heard } : { type: "dictation-end" }));
  }, [on, threadId, dispatch]);
  const dictating = talkState.kind === "dictation" && talkState.phase !== "idle" && !talkState.voice;
  const wasDictating = useRef(dictating);
  useEffect(() => {
    if (wasDictating.current === dictating) return;
    wasDictating.current = dictating;
    if (!dictating && inputRef.current.yielded) dispatch({ type: "dictation-end" });
  }, [dictating, dispatch]);

  // The first time voice mode is on, say how the control works.
  useEffect(() => {
    if (on && takeHint(window.localStorage)) run("show-hint");
  }, [on, run]);

  // Screenshots and tests: a voice state without audio.
  useEffect(() => {
    const onFixture = (event: Event) => {
      const detail = (event as CustomEvent<{ threadId?: string; state?: string | null }>).detail;
      if (detail?.threadId !== threadId) return;
      const next = FIXTURES.find((each) => each === detail.state) ?? null;
      setFixture(next === "hint" ? null : next);
      voicePlayer.setHint(next === "hint" ? threadId : null);
    };
    window.addEventListener(VOICE_FIXTURE_EVENT, onFixture);
    return () => window.removeEventListener(VOICE_FIXTURE_EVENT, onFixture);
  }, [threadId]);

  // Escape while holding to talk drops the turn.
  const holding = input.pressedAt !== null;
  useEffect(() => {
    if (!holding) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") dispatch({ type: "cancel" }); };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [holding, dispatch]);

  // Push-to-talk from the hold-to-talk key (or a command) cuts the Bot off too.
  useEffect(() => { if (capturing && inputRef.current.sub === "ptt") voicePlayer.stop(); }, [capturing]);

  // Hands-free keeps the mic open between turns.
  const talkIdle = talkState.phase === "idle";
  useEffect(() => {
    if (!fixture && wantsCapture(on, input, talkIdle)) run("start-capture");
  }, [on, input, talkIdle, fixture, run]);

  // Turn taking: talking over the Bot stops it; in hands-free, a pause after you speak sends.
  useEffect(() => {
    if (!on || !capturing || fixture) return;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const sample = talk.activity();
      const dt = now - last;
      last = now;
      if (!sample) return;
      const { bargeIn, turnEnd } = gate.current.push(sample, dt, speakingRef.current);
      if (bargeIn) dispatch({ type: "barge-in" });
      if (turnEnd) dispatch({ type: "turn-end" });
    }, 100);
    return () => window.clearInterval(timer);
  }, [on, capturing, fixture, dispatch]);

  // Leaving the thread closes a hands-free mic that hasn't heard anything.
  useEffect(() => () => {
    const state = talk.getState();
    if (inputRef.current.sub === "hands-free" && !gate.current.heard && state.voice && state.threadId === threadId && state.phase === "recording") void talk.stop(false);
  }, [threadId]);

  useEffect(() => {
    const toggle = (event: Event) => { if ((event as CustomEvent<{ threadId?: string }>).detail?.threadId === threadId) void set(!on); };
    window.addEventListener(TOGGLE_VOICE_EVENT, toggle);
    return () => window.removeEventListener(TOGGLE_VOICE_EVENT, toggle);
  }, [threadId, on, set]);

  // While you talk, your words stream into the input after what was typed.
  const typed = useRef<string | null>(null);
  const composerRef = useRef(composer);
  composerRef.current = composer;
  useEffect(() => {
    if (!on || !listening) { typed.current = null; return; }
    if (typed.current === null) typed.current = composer.text;
    const heard = talkState.transcript.trim();
    const before = typed.current;
    composer.replace((current) => ({ text: joinText(before, heard), mentions: current.mentions.filter((mention) => mention.to <= before.length) }));
  }, [on, listening, talkState.transcript, composer]);

  // When you finish, what you said is sent; the input goes back to empty.
  useEffect(() => {
    if (!on) return;
    return voicePlayer.takeDictations(threadId, (heard) => {
      const current = composerRef.current;
      const text = joinText(typed.current ?? current.text, heard).trim();
      typed.current = null;
      if (current.draft.mentions.length || current.attachmentCount) {
        // Mentions and files can't be sent from here: leave it for Send.
        current.replace((draft) => ({ text, mentions: draft.mentions }));
        return;
      }
      current.replace({ text: "", mentions: [] });
      // The guidance rides along unseen (instructions only reach a running session at its next start).
      // Studio picks it: conversational while that's on, a one-time "it's off" after it's turned off.
      rpcRef.current.call("voice.turnNote", { threadId }).then((result) => result.note, () => null)
        .then((note) => sdk.threads.send({ threadId, mode: "auto", input: [{ type: "text", text, mentions: [] }, ...(note ? [{ type: "text", text: note, mentions: [], visibility: "agent-only" }] : [])] } as never))
        .catch((error: unknown) => {
          const latest = composerRef.current;
          const restored = canRestoreFailedDictation(latest.draft, latest.attachmentCount);
          if (restored) latest.replace({ text, mentions: [] });
          toast.error("Couldn't send what you said", {
            description: errorMessage(error),
            ...(!restored ? { action: { label: "Add to draft", onClick: () => composerRef.current.replace((draft) => ({ text: joinText(draft.text, text), mentions: draft.mentions })) } } : {}),
          });
        });
    });
  }, [on, threadId, sdk]);

  useRealtime(VOICE_REALTIME_CHANNEL, (event) => {
    const spoken = event as VoiceSpoken;
    if (!on || spoken.threadId !== threadId) return;
    if (spoken.problem) return void toast.error("Couldn't speak the reply", { description: spoken.problem });
    // Not over you: while you hold to talk, or once hands-free has heard you this turn.
    const state = inputRef.current;
    const talking = state.sub === "ptt" ? state.pressedAt !== null || capturingRef.current : gate.current.heard;
    if (talking || !spoken.urls.length) return;
    voicePlayer.play(threadId, spoken.urls, spoken.pieces, spoken.eventId).catch((error: unknown) => toast.error("Couldn't play the reply", { description: errorMessage(error) }));
  });

  const press = (at: number) => { voicePlayer.setHint(null); dispatch({ type: "press", at }); };
  const release = (at: number) => { releasedAt.current = at; dispatch({ type: "release", at, heard: gate.current.heard }); };
  const handsFree = view.sub === "hands-free";
  const inputShown = view.indicator === "input";
  const pttLabel = inputShown
    ? (handsFree ? "Listening hands-free. Tap for push-to-talk" : "Listening. Release to send")
    : "Hold to talk";
  const label = on ? "Voice mode on: replies are spoken. Turn off" : "Voice mode: speak replies aloud";
  const loading = snapshot.playing === "loading" && !fixture;
  return (
    <>
      <span ref={anchor} hidden data-studio-voice-anchor="" />
      {/* The state word, for screen readers: the field's placeholder has no plugin API yet. */}
      <span className="sr-only" role="status" aria-live="polite">{view.placeholder ?? ""}</span>
      {view.indicator === "output" ? (
        <span data-studio-voice-output="" className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-sky-500/10 pl-2.5 text-xs text-sky-600 dark:text-sky-400" role="status" aria-label={loading ? "Getting ready to speak" : "Speaking"} title={loading ? "Getting ready to speak" : "Speaking"}>
          <Icon name="studio/speaker" className="size-3.5 shrink-0" />
          <Wave level={fixture ? fixtureLevel : outputLevel} className="bg-sky-500 dark:bg-sky-400" />
          <Tooltip label="Speed" side="top">
            <button type="button" aria-label={`Speed ${speed}×, change`} className="inline-flex h-8 min-w-9 shrink-0 items-center justify-center rounded-md px-1.5 text-xs font-medium tabular-nums text-foreground outline-none hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring" onClick={() => changeSpeed(nextSpeed(speed))}>
              {speed}×
            </button>
          </Tooltip>
          <Tooltip label="Stop speaking" side="top">
            <button type="button" aria-label="Stop speaking" className={cn(ACTION_BUTTON, "rounded-full")} onClick={() => voicePlayer.stop()}>
              <Icon name="Square" className="size-3.5" />
            </button>
          </Tooltip>
        </span>
      ) : null}
      {view.ptt || inputShown ? (
        <Tooltip label={inputShown ? (handsFree ? "Tap for push-to-talk" : "Release to send") : HINT_TEXT} side="top">
          <button
            type="button"
            aria-label={pttLabel}
            aria-pressed={inputShown && !handsFree}
            data-studio-voice-input={inputShown ? view.sub : undefined}
            data-studio-voice-ptt=""
            className={cn(
              "inline-flex h-8 shrink-0 touch-none select-none items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring",
              inputShown ? "gap-2 bg-red-500/10 pl-2.5 pr-3 text-red-600 hover:bg-red-500/15 dark:text-red-400" : "w-8 text-muted-foreground hover:bg-state-hover hover:text-foreground [&_svg]:size-4",
            )}
            onPointerDown={(event) => {
              if (event.button !== 0 || handsFree) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture?.(event.pointerId);
              press(performance.now());
            }}
            onPointerUp={() => { if (!handsFree) release(performance.now()); }}
            onPointerCancel={() => dispatch({ type: "cancel" })}
            onKeyDown={(event) => {
              if ((event.key !== " " && event.key !== "Enter") || event.repeat || handsFree) return;
              event.preventDefault();
              press(performance.now());
            }}
            onKeyUp={(event) => {
              if ((event.key !== " " && event.key !== "Enter") || handsFree) return;
              event.preventDefault();
              release(performance.now());
            }}
            onClick={() => {
              // The click that ends a long press isn't a tap on the new pill.
              if (!handsFree || performance.now() - releasedAt.current <= 400) return;
              if (fixture) setFixture(null);
              else dispatch({ type: "tap-pill", heard: gate.current.heard });
            }}
          >
            {inputShown ? (
              <>
                <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-red-500" />
                <Wave level={fixture ? fixtureLevel : inputLevel} className="bg-red-500" />
              </>
            ) : (
              <Icon name="Mic" className="size-4" />
            )}
          </button>
        </Tooltip>
      ) : null}
      {/* A split button, like Send: the speaker turns voice mode on or off; the caret opens its settings. */}
      <span className={cn("inline-flex h-8 shrink-0 items-center rounded-md", on ? "bg-primary/15 text-primary" : "")}>
        <Tooltip label={label} side="top">
          <button type="button" aria-label={label} aria-pressed={on} className={cn(ACTION_BUTTON, "rounded-r-none", on ? "text-primary hover:text-primary" : "")} onClick={() => void set(!on)}>
            <Icon name={on ? "studio/speaker" : "studio/speaker-off"} className="size-4" />
          </button>
        </Tooltip>
        <Popover>
          <Tooltip label="Voice settings" side="top">
            <PopoverTrigger asChild>
              <button type="button" aria-label="Voice settings" className={cn(ACTION_BUTTON, "w-5 rounded-l-none", on ? "text-primary hover:text-primary" : "")}>
                <Icon name="ChevronDown" className="size-3.5" />
              </button>
            </PopoverTrigger>
          </Tooltip>
          <PopoverContent side="top" align="end" className="p-0">
            {/* Portaled out of Studio's root: Studio's styles apply only inside its scope. */}
            <div data-bb-plugin="studio" data-bb-plugin-root="" className="w-[20rem] max-w-[calc(100vw-1rem)] px-3 py-2.5">
              <SpeechSection compact onState={(state) => followSpeed(state.speed)}>
                <div className="flex items-center gap-2">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-xs font-medium text-foreground">Conversational replies</span>
                    <span className="truncate text-xs text-muted-foreground">Short spoken answers, no markdown</span>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={conversational}
                    aria-label="Conversational replies"
                    onClick={() => void setConversational(!conversational)}
                    className={cn("relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring", conversational ? "bg-primary" : "bg-muted")}
                  >
                    <span className={cn("inline-block size-3 rounded-full bg-background shadow transition-transform", conversational ? "translate-x-3.5" : "translate-x-0.5")} />
                  </button>
                </div>
              </SpeechSection>
            </div>
          </PopoverContent>
        </Popover>
      </span>
    </>
  );
}

/** What was typed, then what was said, with one space between. */
export function joinText(typed: string, heard: string): string {
  if (!heard) return typed;
  if (!typed.trim()) return heard;
  return /\s$/.test(typed) ? `${typed}${heard}` : `${typed} ${heard}`;
}

/** A small rolling level meter, drawn on animation frames. */
function Wave({ level, className }: { level: () => number; className: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const bars = [...(ref.current?.children ?? [])] as HTMLElement[];
    const history = new Array<number>(bars.length).fill(0);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let last = 0;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      if (now - last < (reduce ? 400 : 70)) return;
      last = now;
      history.shift();
      history.push(level());
      bars.forEach((bar, index) => { bar.style.height = `${2 + Math.round(history[index]! * 14)}px`; });
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [level]);
  return (
    <span ref={ref} aria-hidden className="flex h-4 w-20 items-center gap-0.5 overflow-hidden max-sm:w-10">
      {Array.from({ length: BARS }, (_, index) => <span key={index} className={`block h-0.5 w-0.5 shrink-0 rounded-full ${className}`} />)}
    </span>
  );
}

function newVoiceChat(projectId: string | null): void {
  window.dispatchEvent(new CustomEvent(NEW_VOICE_CHAT_EVENT, { detail: { projectId } }));
}

/** Above a voice thread's composer, once: how the hold-to-talk control works. */
function VoiceHint() {
  const composer = useComposer();
  const { hint } = useVoiceSnapshot();
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : null;
  if (!threadId || hint !== threadId) return null;
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground" role="note" data-studio-voice-hint="">
      <Icon name="Mic" className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">{HINT_TEXT}</span>
      <button type="button" aria-label="Dismiss" className="inline-flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-state-hover hover:text-foreground" onClick={() => voicePlayer.setHint(null)}>
        <Icon name="X" className="size-3.5" />
      </button>
    </div>
  );
}

/** Makes new voice chats for the button and the command, and opens them. */
function VoiceChatStarter() {
  const rpc = useRpc<typeof voiceContract>();
  const navigate = useBbNavigate();
  useEffect(() => {
    let starting = false;
    const start = (event: Event) => {
      if (starting) return;
      starting = true;
      const projectId = (event as CustomEvent<{ projectId?: string | null }>).detail?.projectId ?? null;
      rpc.call("voice.new", { projectId })
        .then(({ threadId }) => {
          voicePlayer.setOn(threadId, true);
          navigate.toThread(threadId);
        })
        .catch((error: unknown) => toast.error("Couldn't start a voice chat", { description: errorMessage(error) }))
        .finally(() => { starting = false; });
    };
    window.addEventListener(NEW_VOICE_CHAT_EVENT, start);
    return () => window.removeEventListener(NEW_VOICE_CHAT_EVENT, start);
  }, [rpc, navigate]);
  return null;
}

/** Studio's RPC from outside React (a message action's run). */
async function studioRpc<T>(method: string, input: unknown): Promise<T> {
  const response = await fetch(`/api/v1/plugins/studio/rpc/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  const body = await response.json().catch(() => null) as { ok?: boolean; result?: T; error?: { message?: string } } | null;
  if (!body?.ok || body.result === undefined) throw new Error(body?.error?.message ?? "Studio couldn't do that.");
  return body.result;
}
const prepareSpeech = async (text: string) => (await studioRpc<{ url: string }>("speech.prepare", { text })).url;

export function registerVoiceApp(app: PluginAppBuilder): void {
  // Voice mode's captures cut short segments and are sent, not typed in; Talk's own mic dictates as usual.
  talk.voiceDictation = {
    wants: (threadId) => voicePlayer.isOn(threadId),
    deliver: (threadId, text) => voicePlayer.deliver(threadId, text),
    dictating: (threadId, dictating) => voicePlayer.dictating(threadId, dictating),
  };
  app.composer.customize({
    id: "voice",
    scopes: ["thread", "new-thread"],
    actions: [{ id: "voice", component: VoiceControls }],
    banners: [{ id: "ptt-hint", chrome: "bare", component: VoiceHint }],
  });
  app.slots.experimental_appOverlay({ id: "voice-chat-starter", component: VoiceChatStarter });
  // Under any reply: read it aloud (again), in the Speech voice and speed; pressing it while it reads stops it.
  app.slots.messageAction({
    id: "read-aloud",
    title: "Read aloud",
    icon: "Play",
    run({ threadId, message, selectedText }) {
      const text = (selectedText ?? message.text).trim();
      if (!text) return;
      // At Speech's speed, even where no voice composer has set it yet.
      void studioRpc<{ speed: number }>("speech.state", null).then((state) => voicePlayer.setRate(state.speed), () => {});
      voicePlayer.readAloud(threadId, text, prepareSpeech).catch((error: unknown) => toast.error("Couldn't read it aloud", { description: errorMessage(error) }));
    },
  });
  app.commands.register({ id: "new-voice-chat", title: "New voice chat", run: ({ projectId }) => newVoiceChat(projectId) });
  app.commands.register({
    id: "toggle-voice",
    title: "Voice mode: turn on or off in this thread",
    isAvailable: ({ threadId }) => threadId !== null,
    run: ({ threadId }) => { if (threadId) window.dispatchEvent(new CustomEvent(TOGGLE_VOICE_EVENT, { detail: { threadId } })); },
  });
}
