// Hands-free voice's quick settings: the right-click menu on the composer's
// waveform button. Its "Voice settings…" opens Studio's settings page on the
// Voice section (src/settings/ui/sections.tsx). BB's composer action has no menu of
// its own (SDK 0.6.37 and 0.6.104), so this is a context menu on Studio's own
// button. Every choice is a Studio setting (src/settings/schema.ts) read
// when a session starts, so it applies to the next session, never the running
// one: OpenAI fixes a session's voice and models when it's created.
import { useRpc } from "@get-bb/plugin-sdk/app";
import { useState, type ReactNode } from "react";
import { requestVoiceSection, STUDIO_SETTINGS_PATH } from "../../../settings/ui/voice-anchor";
import { openAppPath } from "../../../kit/app/nav";
import { errorMessage } from "../../../kit/format";
import {
  cn, ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuSub,
  ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger, Icon,
} from "../../../kit/ui";
import type { VoiceLiveState, voiceLiveContract } from "../contract";
import { BACKEND_MODELS, LIVE_MODELS, LIVE_VOICES, usd, type BackendModel, type LiveModel } from "../shared";

type Rpc = { call(method: string, input: unknown): Promise<unknown> };
export type VoiceChoice = { model?: LiveModel; voice?: string; backendModel?: BackendModel };

/** Studio's settings page; the Voice section scrolls itself into view. */
export const VOICE_SETTINGS_PATH = STUDIO_SETTINGS_PATH;

const MODEL_NOTES: Record<LiveModel, string> = {
  "gpt-live-1": "$0.05 a minute, plus the backend",
  "gpt-realtime-2.1": "By token, about 7¢ a minute",
};
const BACKEND_NOTES: Record<BackendModel, string> = {
  "gpt-5.6-luna": "Cheapest and fastest",
  "gpt-5.6-terra": "Smarter, about 10× the tokens' price",
  "gpt-5.6-sol": "Smartest, about 20× the tokens' price",
};

export const loadVoiceState = async (rpc: Rpc) => (await rpc.call("voiceLive.state", {})) as VoiceLiveState;
/** Saves a choice as Studio settings for the next session; the new state. */
export const saveVoiceChoice = async (rpc: Rpc, choice: VoiceChoice) => (await rpc.call("voiceLive.configure", choice)) as VoiceLiveState;

export function openVoiceSettings(): void {
  requestVoiceSection();
  openAppPath(VOICE_SETTINGS_PATH);
}

/** Wraps the waveform button: a right-click opens the quick settings. */
export function HandsFreeQuickSettings({ live, children }: { live: boolean; children: ReactNode }) {
  const rpc = useRpc<typeof voiceLiveContract>() as unknown as Rpc;
  const [state, setState] = useState<VoiceLiveState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => { setError(null); loadVoiceState(rpc).then(setState, (cause) => setError(errorMessage(cause))); };
  const choose = (choice: VoiceChoice) => {
    setError(null);
    saveVoiceChoice(rpc, choice).then(setState, (cause) => setError(errorMessage(cause)));
  };
  return (
    <ContextMenu modal={false} onOpenChange={(open) => { if (open) load(); }}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent data-testid="handsfree-menu" aria-label="Hands-free voice settings" className="w-64">
        <QuickSettingsItems state={state} error={error} live={live} choose={choose} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

const CHECK = (on: boolean) => <Icon name="Check" className={cn("size-3.5 shrink-0", !on && "invisible")} aria-hidden />;

function Value({ children }: { children: ReactNode }) {
  return <span className="ml-auto truncate pl-3 text-muted-foreground">{children}</span>;
}

/** The menu's rows, apart from the Radix root so tests can render them open. */
export function QuickSettingsItems({ state, error, live, choose }: { state: VoiceLiveState | null; error: string | null; live: boolean; choose: (choice: VoiceChoice) => void }) {
  const realtime = state?.model === "gpt-realtime-2.1";
  return (
    <>
      <ContextMenuLabel className="pb-0 font-semibold">Hands-free voice</ContextMenuLabel>
      <ContextMenuLabel data-testid="handsfree-menu-next" className="pt-0.5 text-[11px] leading-4 text-muted-foreground">
        {live ? "This session keeps its settings. Changes apply to the next one." : "Changes apply to the next session."}
      </ContextMenuLabel>
      <ContextMenuSeparator />
      {!state ? (
        <ContextMenuLabel className="text-muted-foreground">{error ?? "Loading…"}</ContextMenuLabel>
      ) : (
        <>
          <ContextMenuSub>
            <ContextMenuSubTrigger data-testid="handsfree-menu-model">Model<Value>{state.model}</Value><Icon name="ChevronRight" className="size-3.5 shrink-0" aria-hidden /></ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-64">
              {LIVE_MODELS.map((model) => (
                <ContextMenuItem key={model} data-testid={`handsfree-model-${model}`} aria-checked={state.model === model} role="menuitemradio" onSelect={() => choose({ model })}>
                  {CHECK(state.model === model)}
                  <span className="min-w-0"><span className="block">{model}</span><span className="block text-[11px] text-muted-foreground">{MODEL_NOTES[model]}</span></span>
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSub>
            <ContextMenuSubTrigger data-testid="handsfree-menu-voice">Voice<Value>{state.voice}</Value><Icon name="ChevronRight" className="size-3.5 shrink-0" aria-hidden /></ContextMenuSubTrigger>
            <ContextMenuSubContent data-testid="handsfree-voices" className="max-h-[var(--radix-context-menu-content-available-height)] w-48 overflow-y-auto">
              <ContextMenuLabel className="text-[11px] text-muted-foreground">{state.model}’s voices</ContextMenuLabel>
              {LIVE_VOICES[state.model].map((voice) => (
                <ContextMenuItem key={voice} data-testid={`handsfree-voice-${voice}`} aria-checked={state.voice === voice} role="menuitemradio" onSelect={() => choose({ voice })}>
                  {CHECK(state.voice === voice)}{voice}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSub>
            <ContextMenuSubTrigger data-testid="handsfree-menu-backend" disabled={realtime}>
              Backend model<Value>{realtime ? "None" : state.backendModel}</Value><Icon name="ChevronRight" className="size-3.5 shrink-0" aria-hidden />
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-64">
              {BACKEND_MODELS.map((model) => (
                <ContextMenuItem key={model} data-testid={`handsfree-backend-${model}`} aria-checked={state.backendModel === model} role="menuitemradio" onSelect={() => choose({ backendModel: model })}>
                  {CHECK(state.backendModel === model)}
                  <span className="min-w-0"><span className="block">{model}</span><span className="block text-[11px] text-muted-foreground">{BACKEND_NOTES[model]}</span></span>
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuLabel data-testid="handsfree-menu-spend" className="flex items-baseline">
            This month<span className="ml-auto pl-3 tabular-nums"><span className="font-medium">{usd(state.monthUsd)}</span><span className="text-muted-foreground"> of {usd(state.capUsd)}</span></span>
          </ContextMenuLabel>
          {error ? <ContextMenuLabel role="alert" className="text-[11px] text-destructive">{error}</ContextMenuLabel> : null}
        </>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem data-testid="handsfree-menu-settings" onSelect={() => openVoiceSettings()}>
        <Icon name="Settings" className="size-3.5 shrink-0" aria-hidden />Voice settings…
      </ContextMenuItem>
    </>
  );
}
