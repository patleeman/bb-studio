// Voice mode in BB's own thread view (round 3a of the "Voice mode in a
// thread" design). Beside the composer's mic: a speaker button that turns
// voice mode on for the thread, and a small pill that shows who's talking with
// a live level and no words beside the controls: you (red dot, time) or the agent (its level,
// Stop). While you talk, your words stream into the input phrase by phrase and
// are sent when you finish; while the agent speaks, the piece being read
// lights up in the transcript. New voice chat starts a thread with it on.
import { Icon, Popover, PopoverContent, PopoverTrigger, Tooltip, cn } from "@bb-studio/kit/ui";
import { SpeechSection } from "../../ui/setup/SpeechSection";
import { errorMessage } from "@bb-studio/kit/format";
import { useBbNavigate, useComposer, useRealtime, useRpc, useSdk, type PluginAppBuilder, type PluginComposerApi } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { talk, useTalkState } from "../../talk/ui/controller";
import type { speechContract } from "../../speech/contract";
import type { voiceContract } from "../contract";
import { VOICE_TURN_NOTE } from "../instructions";
import { VOICE_REALTIME_CHANNEL, type VoiceSpoken } from "../shared";
import { useVoiceSnapshot, voicePlayer } from "./state";

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

function ThreadVoiceControls({ composer, threadId }: { composer: PluginComposerApi; threadId: string }) {
  const { on, set, conversational, setConversational } = useVoiceMode(threadId);
  const conversationalRef = useRef(conversational);
  conversationalRef.current = conversational;
  const { speed, change: changeSpeed, follow: followSpeed } = useSpeechSpeed();
  const snapshot = useVoiceSnapshot();
  const talkState = useTalkState();
  const sdk = useSdk();
  const listening = on && talkState.threadId === threadId && talkState.kind === "dictation" && (talkState.phase === "starting" || talkState.phase === "recording" || talkState.phase === "transcribing");
  const speaking = snapshot.threadId === threadId && snapshot.playing !== "idle";

  useEffect(() => {
    const toggle = (event: Event) => { if ((event as CustomEvent<{ threadId?: string }>).detail?.threadId === threadId) void set(!on); };
    window.addEventListener(TOGGLE_VOICE_EVENT, toggle);
    return () => window.removeEventListener(TOGGLE_VOICE_EVENT, toggle);
  }, [threadId, on, set]);

  // Starting to talk cuts the reply off.
  useEffect(() => { if (listening) voicePlayer.stop(); }, [listening]);

  // While you talk, your words stream into the input after what was typed.
  const typed = useRef<string | null>(null);
  const composerRef = useRef(composer);
  composerRef.current = composer;
  useEffect(() => {
    if (!listening) { typed.current = null; return; }
    if (typed.current === null) typed.current = composer.text;
    const heard = talkState.transcript.trim();
    const before = typed.current;
    composer.replace((current) => ({ text: joinText(before, heard), mentions: current.mentions.filter((mention) => mention.to <= before.length) }));
  }, [listening, talkState.transcript, composer]);

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
      // The guidance rides along unseen: instructions only reach a running session at its next start.
      const note = conversationalRef.current ? [{ type: "text", text: VOICE_TURN_NOTE, mentions: [], visibility: "agent-only" }] : [];
      sdk.threads.send({ threadId, mode: "auto", input: [{ type: "text", text, mentions: [] }, ...note] } as never)
        .catch((error: unknown) => {
          current.replace({ text, mentions: [] });
          toast.error("Couldn't send what you said", { description: errorMessage(error) });
        });
    });
  }, [on, threadId, sdk]);

  useRealtime(VOICE_REALTIME_CHANNEL, (event) => {
    const spoken = event as VoiceSpoken;
    if (!on || spoken.threadId !== threadId) return;
    if (spoken.problem) return void toast.error("Couldn't speak the reply", { description: spoken.problem });
    if (listening || !spoken.urls.length) return;
    voicePlayer.play(threadId, spoken.urls, spoken.pieces).catch((error: unknown) => toast.error("Couldn't play the reply", { description: errorMessage(error) }));
  });

  const label = on ? "Voice mode on: replies are spoken. Turn off" : "Voice mode: speak replies aloud";
  return (
    <>
      {on && listening ? (
        <span className="inline-flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-md pl-2.5 pr-1 text-xs text-muted-foreground" role="status" aria-live="polite" aria-label="Listening" title="Listening">
          <span aria-hidden className="size-1.5 rounded-full bg-red-500" />
          <Elapsed recordedMs={talkState.recordedMs} since={talkState.captureStartedAt} />
          <Wave level={() => talk.level()} className="bg-sky-400" />
        </span>
      ) : on && speaking ? (
        <span className="inline-flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-md pl-2.5 text-xs text-muted-foreground" role="status" aria-live="polite" aria-label={snapshot.playing === "loading" ? "Getting ready to speak" : "Speaking"} title={snapshot.playing === "loading" ? "Getting ready to speak" : "Speaking"}>
          <Wave level={() => voicePlayer.level()} className="bg-primary" />
          <Tooltip label="Speed" side="top">
            <button type="button" aria-label={`Speed ${speed}×, change`} className="inline-flex h-8 min-w-9 shrink-0 items-center justify-center rounded-md px-1.5 text-xs font-medium tabular-nums text-foreground outline-none hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring" onClick={() => changeSpeed(nextSpeed(speed))}>
              {speed}×
            </button>
          </Tooltip>
          <Tooltip label="Stop speaking" side="top">
            <button type="button" aria-label="Stop speaking" className={ACTION_BUTTON} onClick={() => voicePlayer.stop()}>
              <Icon name="Square" className="size-3.5" />
            </button>
          </Tooltip>
        </span>
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

function Elapsed({ recordedMs, since }: { recordedMs: number; since: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [since]);
  const seconds = Math.max(0, Math.floor((recordedMs + (since === null ? 0 : now - since)) / 1000));
  return <span className="font-medium tabular-nums text-foreground max-sm:hidden">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>;
}

function newVoiceChat(projectId: string | null): void {
  window.dispatchEvent(new CustomEvent(NEW_VOICE_CHAT_EVENT, { detail: { projectId } }));
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
  // Dictations into a voice thread cut short segments and are sent, not typed in.
  talk.voiceDictation = { wants: (threadId) => voicePlayer.isOn(threadId), deliver: (threadId, text) => voicePlayer.deliver(threadId, text) };
  app.composer.customize({
    id: "voice",
    scopes: ["thread", "new-thread"],
    actions: [{ id: "voice", component: VoiceControls }],
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
