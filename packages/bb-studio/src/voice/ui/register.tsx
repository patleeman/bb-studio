// Voice mode in BB's own thread view (round 3a of the "Voice mode in a
// thread" design). Beside the composer's mic: a speaker button that turns
// voice mode on for the thread, and a small pill that shows who's talking with
// a live level: you (red dot, time, "Listening") or the agent ("Speaking",
// Stop). While you talk, your words stream into the input phrase by phrase and
// are sent when you finish; while the agent speaks, the piece being read
// lights up in the transcript. New voice chat starts a thread with it on.
import { Icon, Tooltip } from "@bb-studio/kit/ui";
import { errorMessage } from "@bb-studio/kit/format";
import { useBbNavigate, useComposer, useRealtime, useRpc, useSdk, type PluginAppBuilder, type PluginComposerApi } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { talk, useTalkState } from "../../talk/ui/controller";
import type { voiceContract } from "../contract";
import { VOICE_REALTIME_CHANNEL, type VoiceSpoken } from "../shared";
import { useVoiceSnapshot, voicePlayer } from "./state";

const NEW_VOICE_CHAT_EVENT = "studio:new-voice-chat";
const TOGGLE_VOICE_EVENT = "studio:toggle-voice";
const BARS = 28;

const ACTION_BUTTON =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4";

/** A thread's voice mode, read once and kept in step with the other controls. */
function useVoiceMode(threadId: string) {
  const rpc = useRpc<typeof voiceContract>();
  const { on } = useVoiceSnapshot();
  useEffect(() => {
    let live = true;
    rpc.call("voice.state", { threadId }).then((state) => { if (live) voicePlayer.setOn(threadId, state.on); }, () => {});
    return () => { live = false; };
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
  return { on: on[threadId] ?? false, set };
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
          <Icon name="AudioLines" fallback="Volume2" />
        </button>
      </Tooltip>
    );
  }
  return null;
}

function ThreadVoiceControls({ composer, threadId }: { composer: PluginComposerApi; threadId: string }) {
  const { on, set } = useVoiceMode(threadId);
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
      sdk.threads.send({ threadId, mode: "auto", input: [{ type: "text", text, mentions: [] }] } as never)
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
        <span className="inline-flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-md pl-2.5 pr-1 text-xs text-muted-foreground" role="status" aria-live="polite">
          <span aria-hidden className="size-1.5 rounded-full bg-red-500" />
          <Elapsed recordedMs={talkState.recordedMs} since={talkState.captureStartedAt} />
          <Wave level={() => talk.level()} className="bg-sky-400" />
          <span className="max-sm:hidden">Listening</span>
        </span>
      ) : on && speaking ? (
        <span className="inline-flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-md pl-2.5 text-xs text-muted-foreground" role="status" aria-live="polite">
          <Wave level={() => voicePlayer.level()} className="bg-primary" />
          <span className="max-sm:hidden">{snapshot.playing === "loading" ? "Getting ready" : "Speaking"}</span>
          <Tooltip label="Stop speaking" side="top">
            <button type="button" aria-label="Stop speaking" className={ACTION_BUTTON} onClick={() => voicePlayer.stop()}>
              <Icon name="Square" fallback="X" />
            </button>
          </Tooltip>
        </span>
      ) : null}
      <Tooltip label={label} side="top">
        <button type="button" aria-label={label} aria-pressed={on} className={`${ACTION_BUTTON} ${on ? "bg-primary/15 text-primary hover:text-primary" : ""}`} onClick={() => void set(!on)}>
          <Icon name={on ? "Volume2" : "VolumeX"} fallback="Volume2" />
        </button>
      </Tooltip>
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

export function registerVoiceApp(app: PluginAppBuilder): void {
  // Dictations into a voice thread cut short segments and are sent, not typed in.
  talk.voiceDictation = { wants: (threadId) => voicePlayer.isOn(threadId), deliver: (threadId, text) => voicePlayer.deliver(threadId, text) };
  app.composer.customize({
    id: "voice",
    scopes: ["thread", "new-thread"],
    actions: [{ id: "voice", component: VoiceControls }],
  });
  app.slots.experimental_appOverlay({ id: "voice-chat-starter", component: VoiceChatStarter });
  app.commands.register({ id: "new-voice-chat", title: "New voice chat", run: ({ projectId }) => newVoiceChat(projectId) });
  app.commands.register({
    id: "toggle-voice",
    title: "Voice mode: turn on or off in this thread",
    isAvailable: ({ threadId }) => threadId !== null,
    run: ({ threadId }) => { if (threadId) window.dispatchEvent(new CustomEvent(TOGGLE_VOICE_EVENT, { detail: { threadId } })); },
  });
}
