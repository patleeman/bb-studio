// Studio → Voice: talk to the voice agent. The conversation is BB's own chat
// for the session's thread, so its composer, history and Talk's mic work as
// everywhere; this page adds speaking the agent's replies aloud.
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@bb-studio/kit/ui";
import { errorMessage } from "@bb-studio/kit/format";
import { ThreadChat, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Speaker, type SpeakerState } from "../../speech/speaker";
import { useTalkState } from "../../talk/ui/controller";
import type { voiceContract, VoiceState } from "../contract";
import { VOICE_REALTIME_CHANNEL, type VoiceSpoken } from "../shared";

const SPEAK_KEY = "studio:voice:speak";
const MODEL_KEY = "studio:voice:model";

function stored(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function store(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* Private mode: not kept. */ }
}

export default function VoicePage() {
  const rpc = useRpc<typeof voiceContract>();
  const [state, setState] = useState<VoiceState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Speaking is per device: the phone may want it when the desktop doesn't.
  const [speak, setSpeak] = useState(() => stored(SPEAK_KEY, "on") === "on");
  const [modelId, setModelId] = useState(() => stored(MODEL_KEY, ""));
  const [playing, setPlaying] = useState<SpeakerState>("idle");
  const speaker = useMemo(() => new Speaker(async () => { throw new Error("Voice plays prepared audio only."); }, setPlaying), []);
  useEffect(() => () => speaker.stop(), [speaker]);

  const load = useCallback(() => rpc.call("voice.state", null).then((next) => { setState(next); setError(null); }, (cause: unknown) => setError(errorMessage(cause))), [rpc]);
  useEffect(() => { void load(); }, [load]);

  // The user starting to talk cuts the agent off.
  const talk = useTalkState();
  useEffect(() => { if (talk.phase !== "idle") speaker.stop(); }, [talk.phase, speaker]);

  useRealtime(VOICE_REALTIME_CHANNEL, (event) => {
    const spoken = event as VoiceSpoken;
    if (!state?.session || spoken.threadId !== state.session.threadId) return;
    void load();
    if (!speak) return;
    if (spoken.problem) return setError(`Couldn't speak the reply: ${spoken.problem}`);
    if (talk.phase !== "idle") return;
    speaker.play(spoken.urls).catch((cause: unknown) => setError(errorMessage(cause)));
  });

  const act = async (run: () => Promise<VoiceState>) => {
    setBusy(true);
    try {
      setState(await run());
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  const chosenModel = state?.models.some((model) => model.id === modelId) ? modelId : state?.models[0]?.id ?? "";
  const start = () => act(() => rpc.call("voice.start", { modelId: chosenModel }));
  const end = () => { speaker.stop(); return act(() => rpc.call("voice.end", null)); };
  const toggleSpeak = () => {
    const next = !speak;
    setSpeak(next);
    store(SPEAK_KEY, next ? "on" : "off");
    if (!next) speaker.stop();
  };

  const session = state?.session ?? null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">Voice</h1>
        {session ? (
          <>
            {state?.pending.length ? <span className="text-xs text-muted-foreground">Waiting on {state.pending.length === 1 ? "1 thread" : `${state.pending.length} threads`}</span> : null}
            {playing !== "idle" ? <Button size="sm" variant="outline" onClick={() => speaker.stop()}>Stop speaking</Button> : null}
            <button
              type="button"
              role="switch"
              aria-checked={speak}
              onClick={toggleSpeak}
              className="rounded-md px-2 py-1 text-xs text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              Speak replies: {speak ? "On" : "Off"}
            </button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void end()}>End session</Button>
          </>
        ) : null}
      </header>
      {error ? <p className="px-4 pt-2 text-xs text-destructive">{error}</p> : null}
      {speak && state?.speechProblem ? (
        <p className="px-4 pt-2 text-xs text-foreground">Replies won't be spoken yet: {state.speechProblem} Set it up in Studio → Setup → Speech.</p>
      ) : null}
      {!state ? <p className="p-4 text-xs text-muted-foreground">Loading…</p> : session ? (
        <div className="min-h-0 flex-1">
          <ThreadChat key={session.threadId} threadId={session.threadId} variant="full" />
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-md flex-col gap-3 p-6">
          <p className="text-sm text-foreground">Talk to BB and hear the answers.</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            A fast assistant answers by voice and hands real work to your Bot or other threads, then tells you what came back.
            Use the composer's mic or your hold-to-talk key to speak.
          </p>
          <label className="flex items-center gap-2">
            <span className="shrink-0 text-xs text-foreground">Model</span>
            <Select value={chosenModel} disabled={busy} onValueChange={(id) => { setModelId(id); store(MODEL_KEY, id); }}>
              <SelectTrigger className="h-8 w-72 text-xs" aria-label="Voice model"><SelectValue /></SelectTrigger>
              <SelectContent>
                {state.models.map((model) => <SelectItem key={model.id} value={model.id}>{model.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <div>
            <Button size="sm" disabled={busy || !chosenModel} onClick={() => void start()}>{busy ? "Starting…" : "Start a voice session"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
