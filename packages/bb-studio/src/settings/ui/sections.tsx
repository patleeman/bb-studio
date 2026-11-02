// Studio's settings page, after BB's API key fields: one section per group
// (schema.ts SETTINGS_GROUPS), in order. Fields show only when they apply
// (the home server's URL only for Home server). The Attention settings are
// on the Bot page (BotAttention.tsx). Last, Phone notifications: Studio
// Mobile's push status and test push (PushSection.tsx). BB's Mobile page
// would be the natural home, but stable BB (0.48.1) draws `experimental_page:
// "mobile"` sections only for the machine-access plugin picked under
// "Accessing bb from your phone", so it stays here.
import { useRpc, type PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef, useState } from "react";
import { openAppPath } from "../../kit/app/nav";
import { Button } from "../../kit/ui/index";
import { FallbackModel, JevConnection } from "../../decisions/ui/register";
import { ModelSettings } from "../../talk/ui/model-settings";
import { appliedMenuSettings, menuSettings, needsMenuReload } from "../../reactions/settings";
import { loadVoiceState } from "../../voice/live/ui/QuickSettings";
import type { VoiceLiveState, voiceLiveContract } from "../../voice/live/contract";
import { LIVE_VOICES, usd } from "../../voice/live/shared";
import { CALL_STT_OPTIONS } from "../../kit/talk-contract";
import { useLive } from "../../ui/live";
import { botPath } from "../../ui/bot/selection";
import { SETTINGS_GROUPS, STUDIO_SETTINGS } from "../schema";
import { Card, Disclosure, Row, SectionState, Segmented, SettingControl, SettingRow, SubHeading } from "./controls";
import { PushSection } from "./PushSection";
import { useStudioSettings } from "./use-settings";
import { takeVoiceSectionRequest, VOICE_SECTION_ANCHOR } from "./voice-anchor";

type Rpc = { call(method: string, input: unknown): Promise<unknown> };

function VoiceSection() {
  const { values } = useStudioSettings();
  const rpc = useRpc<typeof voiceLiveContract>() as unknown as Rpc;
  const [voice, setVoice] = useState<VoiceLiveState | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { void loadVoiceState(rpc).then(setVoice, () => {}); }, [rpc, values?.voiceLiveMonthlyCapUsd]);
  // Asked for by "Voice settings…": BB's key fields above load after this
  // mounts and push it down, so scroll again as the page settles.
  useEffect(() => {
    if (!takeVoiceSectionRequest()) return;
    const timers = [0, 300, 800, 1600].map((ms) => setTimeout(() => ref.current?.scrollIntoView({ block: "start" }), ms));
    return () => timers.forEach(clearTimeout);
  }, []);
  const model = values?.voiceLiveModel === "gpt-realtime-2.1" ? "gpt-realtime-2.1" : "gpt-live-1";
  const month = new Date().toLocaleString("en", { month: "long" });
  return (
    <div ref={ref} id={VOICE_SECTION_ANCHOR} data-testid="studio-settings-voice" className="scroll-mt-4">
      <SectionState>
        <Card>
          <SettingRow k="holdToTalkKey" />
          <SettingRow k="replaceBuiltInDictation" />
          <SubHeading>Hands-free</SubHeading>
          <SettingRow k="voiceLiveModel" />
          <SettingRow k="voiceLiveVoice" options={LIVE_VOICES[model]} />
          <SettingRow k="voiceLiveBackendModel" disabled={model === "gpt-realtime-2.1"} description={model === "gpt-realtime-2.1" ? "Only gpt-live-1 uses a backend model." : undefined} />
          <SettingRow k="voiceLiveMonthlyCapUsd" prefix="$"
            description={<>{voice ? `${usd(voice.monthUsd)} used in ${month}. ` : ""}{STUDIO_SETTINGS.voiceLiveMonthlyCapUsd.description}</>} />
        </Card>
        <p className="mt-2 text-xs text-muted-foreground">Right-click the waveform button in a composer for the same hands-free choices. Changes apply to the next session.</p>
      </SectionState>
    </div>
  );
}

function RecordingsSection() {
  const { values } = useStudioSettings();
  const home = values?.callTranscription === CALL_STT_OPTIONS[1];
  const local = values?.callTranscription === CALL_STT_OPTIONS[0];
  const { set } = useStudioSettings();
  const labels = STUDIO_SETTINGS.callTranscription.optionLabels;
  return (
    <SectionState>
      <Card>
        <SettingRow k="autoTitle" />
        <SettingRow k="autoMeetingNotes" />
        <Row label={STUDIO_SETTINGS.callTranscription.label} description={STUDIO_SETTINGS.callTranscription.description} testId="setting-callTranscription">
          <Segmented label="Transcribe calls" value={String(values?.callTranscription ?? CALL_STT_OPTIONS[0])}
            options={CALL_STT_OPTIONS.map((option) => ({ value: option as string, label: labels[option] }))}
            onChange={(next) => void set({ callTranscription: next })} />
        </Row>
        {home ? <SettingRow k="callServerUrl" indent /> : null}
        <SettingRow k="dictationAudioDays" />
        <SettingRow k="callAudioRetention" />
        <Disclosure label="Transcription models" testId="settings-transcription-models">
          {local ? <SettingRow k="callLocalModel" /> : null}
          {home ? <SettingRow k="callServerModel" /> : null}
          {!local && !home ? <Row label="BB voice service" description="It uses the model chosen in Settings ▸ AI services." /> : null}
        </Disclosure>
        <Disclosure label="Models for titles, summaries and cleanup" testId="settings-talk-models">
          <div className="px-4 py-3"><ModelSettings /></div>
        </Disclosure>
      </Card>
    </SectionState>
  );
}

function RepliesSection() {
  const { values, set } = useStudioSettings();
  const applied = appliedMenuSettings();
  const reload = !!values && !!applied && needsMenuReload(applied, menuSettings(values));
  const quote = !values?.quoteSelection ? "off" : values.quotePosition === "after" ? "after" : "before";
  return (
    <SectionState>
      <Card>
        <SettingRow k="explore_next" />
        <SettingRow k="explore_explore" indent />
        <SettingRow k="explore_quickReplies" indent />
        <SettingRow k="explore_replyItems" indent />
        <SubHeading>Reactions</SubHeading>
        <SettingRow k="emojiItems" />
        <SettingRow k="showInSelectionMenu" />
        <SettingRow k="showInAssistantBar" />
        <SettingRow k="showInUserBar" />
        <Row label={STUDIO_SETTINGS.quoteSelection.label} description={STUDIO_SETTINGS.quoteSelection.description} testId="setting-quoteSelection">
          <Segmented label="Quote the selected text" value={quote}
            options={[{ value: "before", label: "Before" }, { value: "after", label: "After" }, { value: "off", label: "Off" }]}
            onChange={(next) => void set(next === "off" ? { quoteSelection: false } : { quoteSelection: true, quotePosition: next })} />
        </Row>
        {reload ? (
          <Row label="Reload to apply" description="Reaction changes reach message menus after this window reloads.">
            <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>Reload window</Button>
          </Row>
        ) : null}
      </Card>
    </SectionState>
  );
}

function ThreadsSection() {
  const bot = useLive("bot_get", {}, { pollMs: 300_000 }).data?.bot ?? null;
  const attention = bot ? `${botPath(bot.id)}/controls#attention` : null;
  return (
    <SectionState>
      <Card>
        <SettingRow k="decisions_enabled" />
        <SettingRow k="autoResumeThreads" />
        <SettingRow k="loopsEnabled" description={<>Collect what needs you into Loops. The daily budget and quiet hours are on{" "}
          {attention ? <button type="button" className="underline hover:text-foreground" onClick={() => openAppPath(attention)}>Bot ▸ Controls ▸ Attention</button> : "Bot ▸ Controls ▸ Attention"}.</>} />
        <SettingRow k="snapshotsPerPage" />
      </Card>
    </SectionState>
  );
}

function JevSection() {
  return (
    <SectionState>
      <Card>
        <SettingRow k="decisions_jevProvider" />
        <JevConnection bare />
        <FallbackModel bare />
        <Disclosure label="Your own Jev endpoint" testId="settings-jev-endpoint">
          <SettingRow k="decisions_customJevEndpoint" />
          <SettingRow k="decisions_customJevModel" />
          <SettingRow k="decisions_customJevHeaders" />
          <SettingRow k="decisions_customJevApiKeyCommand" description={<>{STUDIO_SETTINGS.decisions_customJevApiKeyCommand.description} Or set its key in the API keys above (Your own Jev endpoint: key).</>} />
        </Disclosure>
      </Card>
    </SectionState>
  );
}

function AdvancedSection() {
  return (
    <SectionState>
      <Card>
        <Row label={STUDIO_SETTINGS.decisions_batchConfidence.label} description={STUDIO_SETTINGS.decisions_batchConfidence.description} testId="setting-decisions_batchConfidence">
          <SettingControl k="decisions_batchConfidence" />
        </Row>
      </Card>
      <p className="mt-2 text-xs text-muted-foreground">Every setting here can also be read and changed with <code>bb studio settings</code>.</p>
    </SectionState>
  );
}

const SECTIONS = { voice: VoiceSection, recordings: RecordingsSection, replies: RepliesSection, threads: ThreadsSection, jev: JevSection, advanced: AdvancedSection };

/** Studio's settings sections, in order; BB draws them after the API key fields. Phone notifications comes last. */
export function registerSettingsApp(app: PluginAppBuilder): void {
  for (const group of SETTINGS_GROUPS) {
    app.slots.settingsSection({ id: `settings-${group.id}`, title: group.title, description: group.description, component: SECTIONS[group.id] });
  }
  app.slots.settingsSection({ id: "mobile-push", title: "Phone notifications", description: "Pushes to the BB Studio app, sent by the Studio Mobile plugin.", component: PushSection });
}
