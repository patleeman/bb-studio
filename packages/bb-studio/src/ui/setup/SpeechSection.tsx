// The Speech section of the Setup page: which engine, model and voice Studio
// speaks with, and a sample to choose by ear. Keys live in Studio's plugin
// settings, where BB keeps secrets. See src/speech/.
import { Button, cn, Icon, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea, Tooltip } from "@bb-studio/kit/ui";
import { errorMessage } from "@bb-studio/kit/format";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LocalSpeechStatus, speechContract, SpeechState } from "../../speech/contract";
import { Speaker, type SpeakerState } from "../../speech/speaker";

type Model = { id: string; name: string; pricePerMillionChars?: number; voices: string[] | null; voiceNames?: Record<string, string> };

const SAMPLE = "Done. The build thread finished, and two tests fail in the auth module. Want me to read you the errors?";
/** The Select's value for "the model's default voice". */
const DEFAULT_VOICE = "__default__";
const SPEEDS: number[] = [0.75, 1, 1.15, 1.25, 1.5, 1.75, 2];

function price(model: Model): string {
  return model.pricePerMillionChars === undefined ? "" : ` · $${model.pricePerMillionChars}/M chars`;
}

const LOCAL_LABELS: Record<LocalSpeechStatus["state"], string> = {
  unsupported: "Not available on this host",
  "not-installed": "Not installed",
  installing: "Installing…",
  stopped: "Stopped",
  starting: "Starting…",
  ready: "Running",
  failed: "Failed",
};

/** Studio's own voice server: install it, see it start, read why it failed. */
function LocalVoices({ local, busy, label, onAction }: { local: LocalSpeechStatus; busy: boolean; label: string; onAction(action: "install" | "start" | "stop"): void }) {
  const showLog = local.log.length > 0 && (local.state === "installing" || local.state === "failed" || local.state === "starting");
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className={label}>Server</span>
        <span className="text-xs text-foreground">{LOCAL_LABELS[local.state]}</span>
        {local.state === "not-installed" || (local.state === "failed" && !local.installed) ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction("install")}>{local.state === "failed" ? "Install again" : "Install"}</Button>
        ) : null}
        {local.installed && (local.state === "stopped" || local.state === "failed") ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction("start")}>Start</Button>
        ) : null}
        {local.state === "ready" || local.state === "starting" ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onAction("stop")}>Stop</Button>
        ) : null}
      </div>
      {local.detail && local.state !== "ready" ? <p className="text-xs text-muted-foreground">{local.detail}</p> : null}
      {local.state === "not-installed" ? (
        <p className="text-xs text-muted-foreground">
          Installs mlx-audio (about 1.3 GB) into Studio's data folder with uv. Voices then download on first use and never leave this Mac.
        </p>
      ) : null}
      {showLog ? (
        <pre className="max-h-40 overflow-auto rounded bg-muted p-2 text-[11px] leading-4 text-muted-foreground" aria-label="Local voice server log">{local.log.join("\n")}</pre>
      ) : null}
    </div>
  );
}

/**
 * Setup's Speech section. `compact` is the same controls for a small popover
 * (the voice menu in a thread's composer): no heading or frame, fields that
 * fill the width, and the sample's text fixed.
 */
export function SpeechSection({ compact = false, onState, children }: { compact?: boolean; onState?(state: SpeechState): void; children?: ReactNode } = {}) {
  const rpc = useRpc<typeof speechContract>();
  const [state, setState] = useState<SpeechState | null>(null);
  const [models, setModels] = useState<Model[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sample, setSample] = useState(SAMPLE);
  const [playing, setPlaying] = useState<SpeakerState>("idle");
  const speaker = useMemo(() => new Speaker(
    async (text) => (await rpc.call("speech.prepare", { text })).url,
    setPlaying,
  ), [rpc]);
  useEffect(() => () => speaker.stop(), [speaker]);

  const loadModels = useCallback((next: SpeechState) => {
    setModels(null);
    if (next.problem) return;
    rpc.call("speech.models", null).then((result) => setModels(result.models), (cause: unknown) => { setModels([]); setError(errorMessage(cause)); });
  }, [rpc]);
  useEffect(() => {
    rpc.call("speech.state", null).then((next) => { setState(next); loadModels(next); }, (cause: unknown) => setError(errorMessage(cause)));
  }, [rpc, loadModels]);

  // Follow the local server while it installs or starts; list models again once it's up.
  const localState = state?.engine === "local" ? state.local.state : null;
  useEffect(() => {
    if (localState !== "installing" && localState !== "starting" && localState !== "stopped") return;
    const timer = setInterval(() => {
      rpc.call("speech.state", null).then((next) => {
        setState(next);
        if (next.local.state !== localState && (next.local.state === "ready" || (localState === "installing" && !next.problem))) loadModels(next);
      }, () => {});
    }, 1000);
    return () => clearInterval(timer);
  }, [rpc, localState, loadModels]);

  const localAction = async (action: "install" | "start" | "stop") => {
    setBusy(true);
    try {
      setState(await rpc.call("speech.local", { action }));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  // The sample plays at the saved speed, so you hear what replies will sound like.
  useEffect(() => { if (state) speaker.setRate(state.speed); }, [speaker, state]);
  const onStateRef = useRef(onState);
  onStateRef.current = onState;
  useEffect(() => { if (state) onStateRef.current?.(state); }, [state]);
  const field = compact ? "h-8 min-w-0 flex-1 text-xs" : "h-8 w-80 text-xs";
  const label = compact ? "w-16 shrink-0 text-xs text-foreground" : "w-20 shrink-0 text-xs text-foreground";

  const update = async (change: Partial<Pick<SpeechState, "engine" | "endpoint" | "model" | "voice" | "instructions" | "speed">>) => {
    setBusy(true);
    try {
      const next = await rpc.call("speech.update", change);
      setError(null);
      if (next.engine !== state?.engine || next.endpoint !== state?.endpoint) loadModels(next);
      setState(next);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const play = async () => {
    if (playing !== "idle") return speaker.stop();
    setError(null);
    try {
      await speaker.speak(sample);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const model = models?.find((each) => each.id === state?.model);
  if (compact) {
    return (
      <CompactSpeech state={state} models={models} model={model ?? null} busy={busy} error={error} playing={playing}
        update={(change) => void update(change)} localAction={(action) => void localAction(action)} play={() => void play()}>
        {children}
      </CompactSpeech>
    );
  }
  return (
    <section className="flex flex-col gap-2" aria-label="Speech">
      {compact ? null : (
        <>
          <h2 className="text-sm font-medium text-foreground">Speech</h2>
          <p className="text-xs text-muted-foreground">
            The voice Studio speaks with. Play a sample to choose by ear; changes apply to the next thing spoken.
          </p>
        </>
      )}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {!state ? <p className="text-xs text-muted-foreground">Loading speech settings…</p> : (
        <div className={compact ? "flex flex-col gap-2.5" : "flex flex-col gap-3 rounded-md border border-border p-3"}>
          <label className="flex min-w-0 items-center gap-2">
            <span className={label}>Engine</span>
            <Select value={state.engine} disabled={busy} onValueChange={(engine) => void update({ engine: engine as SpeechState["engine"] })}>
              <SelectTrigger className={compact ? field : "h-8 w-64 text-xs"} aria-label="Speech engine"><SelectValue /></SelectTrigger>
              <SelectContent>
                {state.engines.map((engine) => <SelectItem key={engine.id} value={engine.id}>{engine.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          {state.engine === "custom" ? (
            <label className="flex min-w-0 items-center gap-2">
              <span className={label}>Endpoint</span>
              <Input
                key={state.endpoint}
                className={field}
                defaultValue={state.endpoint}
                placeholder="http://127.0.0.1:8000/v1"
                aria-label="Custom speech endpoint"
                onBlur={(event) => { if (event.target.value.trim() !== state.endpoint) void update({ endpoint: event.target.value.trim() }); }}
              />
            </label>
          ) : null}
          {state.engine === "local" ? <LocalVoices local={state.local} busy={busy} label={label} onAction={(action) => void localAction(action)} /> : null}
          {state.problem && state.engine === "local" ? null : state.problem ? (
            <p className="text-xs text-foreground">
              {state.problem}
              {state.engine === "openrouter" ? " Keys are in BB Settings → Plugins → Studio." : ""}
            </p>
          ) : (
            <>
              <label className="flex min-w-0 items-center gap-2">
                <span className={label}>Model</span>
                {models?.length ? (
                  <Select value={state.model} disabled={busy} onValueChange={(id) => void update({ model: id, voice: "" })}>
                    <SelectTrigger className={field} aria-label="Speech model"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {model ? null : <SelectItem value={state.model}>{state.model}</SelectItem>}
                      {models.map((each) => <SelectItem key={each.id} value={each.id}>{each.name}{price(each)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    key={state.model}
                    className={field}
                    defaultValue={state.model}
                    placeholder={models ? "Model name" : "Loading models…"}
                    aria-label="Speech model"
                    onBlur={(event) => { if (event.target.value.trim() && event.target.value.trim() !== state.model) void update({ model: event.target.value.trim() }); }}
                  />
                )}
              </label>
              <label className="flex min-w-0 items-center gap-2">
                <span className={label}>Voice</span>
                {model?.voices?.length ? (
                  <Select value={state.voice || DEFAULT_VOICE} disabled={busy} onValueChange={(voice) => void update({ voice: voice === DEFAULT_VOICE ? "" : voice })}>
                    <SelectTrigger className={field} aria-label="Speech voice"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={DEFAULT_VOICE}>{model.voiceNames ? `Default: ${model.voiceNames[model.voices[0]!]?.split(" · ")[0] ?? "first"}` : "Model default"}</SelectItem>
                      {state.voice && !model.voices.includes(state.voice) ? <SelectItem value={state.voice}>{state.voice}</SelectItem> : null}
                      {model.voices.map((voice) => <SelectItem key={voice} value={voice}>{model.voiceNames?.[voice] ?? voice}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    key={`${state.model}:${state.voice}`}
                    className={field}
                    defaultValue={state.voice}
                    placeholder={state.engine === "local" ? "Model default, or the path of a recording to clone" : "Model default, or a voice ID"}
                    aria-label="Speech voice"
                    onBlur={(event) => { if (event.target.value.trim() !== state.voice) void update({ voice: event.target.value.trim() }); }}
                  />
                )}
              </label>
              <label className="flex min-w-0 items-center gap-2">
                <span className={label}>Delivery</span>
                <Input
                  key={state.instructions}
                  className={field}
                  defaultValue={state.instructions}
                  placeholder="Warm and calm, a little brisk"
                  aria-label="Speech delivery"
                  onBlur={(event) => { if (event.target.value.trim() !== state.instructions) void update({ instructions: event.target.value.trim() }); }}
                />
              </label>
              <label className="flex min-w-0 items-center gap-2">
                <span className={label}>Speed</span>
                <Select value={String(state.speed)} disabled={busy} onValueChange={(value) => void update({ speed: Number(value) })}>
                  <SelectTrigger className="h-8 w-32 text-xs" aria-label="Speech speed"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(SPEEDS.includes(state.speed) ? SPEEDS : [...SPEEDS, state.speed].sort((a, b) => a - b)).map((speed) => <SelectItem key={speed} value={String(speed)}>{speed === 1 ? "1× (the voice's pace)" : `${speed}×`}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>
              <div className="flex min-w-0 flex-col gap-2">
                {compact ? null : <Textarea className="min-h-16 text-xs" value={sample} onChange={(event) => setSample(event.target.value)} aria-label="Sample text" />}
                <div>
                  <Button size="sm" variant="outline" disabled={!sample.trim()} onClick={() => void play()}>
                    {playing === "idle" ? "Play sample" : playing === "loading" ? "Loading… (stop)" : "Stop"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** The voice menu's quiet borderless dropdown. */
const MENU_TRIGGER = "h-7 w-auto max-w-[13rem] min-w-0 justify-end gap-1 border-0 bg-transparent px-2 text-xs shadow-none hover:bg-state-hover focus:ring-0 focus-visible:ring-1 [&>span]:truncate";
const MENU_ROW = "flex h-8 min-w-0 items-center gap-2";
const MENU_LABEL = "w-16 shrink-0 text-xs text-muted-foreground";
const MENU_SPEEDS = [1, 1.25, 1.5, 1.75, 2];

/** Speech in the voice menu: label-and-value rows like a menu, speed as one tap, the sample on the voice row. */
function CompactSpeech({ state, models, model, busy, error, playing, update, localAction, play, children }: {
  state: SpeechState | null;
  models: Model[] | null;
  model: Model | null;
  busy: boolean;
  error: string | null;
  playing: SpeakerState;
  update(change: Partial<Pick<SpeechState, "engine" | "endpoint" | "model" | "voice" | "instructions" | "speed">>): void;
  localAction(action: "install" | "start" | "stop"): void;
  play(): void;
  children?: ReactNode;
}) {
  const voiceName = (voice: string) => model?.voiceNames?.[voice]?.split(" · ")[0] ?? voice;
  const ready = state && !state.problem;
  return (
    <section className="flex flex-col" aria-label="Speech">
      {children ? <div className="pb-2.5">{children}</div> : null}
      {error ? <p className="pb-2 text-xs text-destructive">{error}</p> : null}
      {!state ? <p className="py-2 text-xs text-muted-foreground">Loading…</p> : (
        <>
          <div className="flex flex-col border-t border-border py-1.5">
            <div className={MENU_ROW}>
              <span className={MENU_LABEL}>Engine</span>
              <span className="flex-1" />
              <Select value={state.engine} disabled={busy} onValueChange={(engine) => update({ engine: engine as SpeechState["engine"] })}>
                <SelectTrigger className={MENU_TRIGGER} aria-label="Speech engine"><SelectValue /></SelectTrigger>
                <SelectContent>{state.engines.map((engine) => <SelectItem key={engine.id} value={engine.id}>{engine.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {state.engine === "local" ? (
              <div className={MENU_ROW}>
                <span className={MENU_LABEL}>Server</span>
                <span className="min-w-0 flex-1 truncate px-2 text-right text-xs text-foreground">{LOCAL_LABELS[state.local.state]}</span>
                {state.local.state === "not-installed" || (state.local.state === "failed" && !state.local.installed) ? (
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => localAction("install")}>{state.local.state === "failed" ? "Install again" : "Install"}</Button>
                ) : state.local.installed && (state.local.state === "stopped" || state.local.state === "failed") ? (
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => localAction("start")}>Start</Button>
                ) : null}
              </div>
            ) : null}
            {state.engine === "local" && state.local.state === "not-installed" ? (
              <p className="pb-1 text-xs leading-relaxed text-muted-foreground">About 1.3 GB, into Studio's data folder. Voices stay on this Mac.</p>
            ) : null}
            {state.engine === "local" && (state.local.state === "installing" || state.local.state === "failed") && state.local.log.length ? (
              <pre className="mb-1 max-h-24 overflow-auto rounded bg-muted p-2 text-[11px] leading-4 text-muted-foreground">{state.local.log.slice(-6).join("\n")}</pre>
            ) : null}
            {state.engine === "custom" ? (
              <div className={MENU_ROW}>
                <span className={MENU_LABEL}>Endpoint</span>
                <Input key={state.endpoint} className="h-7 min-w-0 flex-1 border-0 bg-transparent px-2 text-right text-xs shadow-none hover:bg-state-hover" defaultValue={state.endpoint} placeholder="http://127.0.0.1:8000/v1" aria-label="Custom speech endpoint"
                  onBlur={(event) => { if (event.target.value.trim() !== state.endpoint) update({ endpoint: event.target.value.trim() }); }} />
              </div>
            ) : null}
            {state.problem && state.engine !== "local" ? <p className="pb-1 text-xs leading-relaxed text-muted-foreground">{state.problem}</p> : null}
            {ready ? (
              <>
                <div className={MENU_ROW}>
                  <span className={MENU_LABEL}>Model</span>
                  <span className="flex-1" />
                  {models?.length ? (
                    <Select value={state.model} disabled={busy} onValueChange={(id) => update({ model: id, voice: "" })}>
                      <SelectTrigger className={MENU_TRIGGER} aria-label="Speech model"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {model ? null : <SelectItem value={state.model}>{state.model}</SelectItem>}
                        {/* "Fish Audio: Drama 3" reads as "Drama 3" here; the list is grouped by maker already. */}
                        {models.map((each) => <SelectItem key={each.id} value={each.id}>{each.name.replace(/^[^:]{1,40}:\s*/, "")}{price(each).replace(" chars", "")}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : <span className="truncate px-2 text-xs text-foreground">{models ? state.model : "Loading…"}</span>}
                </div>
                <div className={MENU_ROW}>
                  <span className={MENU_LABEL}>Voice</span>
                  <span className="flex-1" />
                  {model?.voices?.length ? (
                    <Select value={state.voice || DEFAULT_VOICE} disabled={busy} onValueChange={(voice) => update({ voice: voice === DEFAULT_VOICE ? "" : voice })}>
                      <SelectTrigger className={MENU_TRIGGER} aria-label="Speech voice"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={DEFAULT_VOICE}>{model.voiceNames ? `${voiceName(model.voices[0]!)} (default)` : "Model default"}</SelectItem>
                        {state.voice && !model.voices.includes(state.voice) ? <SelectItem value={state.voice}>{state.voice}</SelectItem> : null}
                        {model.voices.map((voice) => <SelectItem key={voice} value={voice}>{model.voiceNames?.[voice] ?? voice}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input key={`${state.model}:${state.voice}`} className="h-7 min-w-0 flex-1 border-0 bg-transparent px-2 text-right text-xs shadow-none hover:bg-state-hover" defaultValue={state.voice} placeholder="Default" aria-label="Speech voice"
                      onBlur={(event) => { if (event.target.value.trim() !== state.voice) update({ voice: event.target.value.trim() }); }} />
                  )}
                  <Tooltip label={playing === "idle" ? "Play a sample" : "Stop"} side="top">
                    <button type="button" aria-label={playing === "idle" ? "Play a sample" : "Stop the sample"} onClick={play}
                      className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-state-hover hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring">
                      <Icon name={playing === "idle" ? "Play" : "Square"} className="size-3.5" />
                    </button>
                  </Tooltip>
                </div>
                <div className={MENU_ROW}>
                  <span className={MENU_LABEL}>Delivery</span>
                  <Input key={state.instructions} className="h-7 min-w-0 flex-1 border-0 bg-transparent px-2 text-right text-xs shadow-none placeholder:text-muted-foreground/60 hover:bg-state-hover" defaultValue={state.instructions} placeholder="Natural" aria-label="Speech delivery"
                    onBlur={(event) => { if (event.target.value.trim() !== state.instructions) update({ instructions: event.target.value.trim() }); }} />
                </div>
              </>
            ) : null}
          </div>
          <div className="flex items-center gap-2 border-t border-border pt-2.5" role="group" aria-label="Speech speed">
            <span className={MENU_LABEL}>Speed</span>
            <div className="flex min-w-0 flex-1 items-center justify-end gap-0.5 rounded-md bg-muted/60 p-0.5">
              {MENU_SPEEDS.map((speed) => (
                <button key={speed} type="button" aria-pressed={state.speed === speed} disabled={busy} onClick={() => update({ speed })}
                  className={cn("h-6 flex-1 rounded px-1 text-xs tabular-nums outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring",
                    state.speed === speed ? "bg-background font-medium text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground")}>
                  {speed}×
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
