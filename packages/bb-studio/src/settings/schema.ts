// Studio's own settings: every setting that isn't an API key. They live in
// Studio's storage (store.ts), not BB's declared settings, so Studio can
// draw them in grouped sections (ui/sections.tsx) with plain labels.
// `bb studio settings` reads and changes them (cli.ts). API keys stay BB's
// secret fields (keys.ts). Key names are the ones BB's settings used, so a
// value migrates as is (migrate.ts).
//
// The frontend imports this file: keep it free of server and root SDK imports.
import { CALL_RETENTION_OPTIONS, CALL_STT_OPTIONS, HOLD_KEY_OPTIONS } from "../kit/talk-contract";
import { DEFAULT_REPLIES } from "../kit/pages-contract";
import { DEFAULT_EMOJI_ITEMS } from "../reactions/emoji-items";
import { jevProviderChoices } from "../decisions/server/jev-providers";
import { ALL_VOICES, BACKEND_MODELS, DEFAULT_BACKEND_MODEL, DEFAULT_CAP_USD, DEFAULT_VOICE, LIVE_MODELS } from "../voice/live/shared";

/** Studio publishes `{}` on this realtime channel after its settings change. */
export const SETTINGS_CHANNEL = "studio-settings";

/** Where a setting shows. `attention` is on the Bot page (Controls ▸ Attention), not the settings page. */
export type SettingGroup = "voice" | "recordings" | "replies" | "threads" | "jev" | "advanced" | "attention";

interface Base { label: string; description?: string; group: SettingGroup }
export type StudioSetting = Base & (
  | { type: "boolean"; default: boolean }
  | { type: "number"; default: number; min: number; max: number; integer?: boolean }
  | { type: "string"; default: string; maxLength: number; multiline?: boolean }
  | { type: "select"; default: string; options: readonly string[]; optionLabels?: Record<string, string> }
);
export type SettingValue = boolean | number | string;

export const SETTINGS_GROUPS: readonly { id: Exclude<SettingGroup, "attention">; title: string; description: string }[] = [
  { id: "voice", title: "Voice", description: "Dictation, and talking to Studio hands-free." },
  { id: "recordings", title: "Recordings and calls", description: "Names, summaries, transcription and how long audio stays." },
  { id: "replies", title: "Agent replies", description: "The row of next steps under replies, and reactions." },
  { id: "threads", title: "Threads", description: "How Studio helps with busy and interrupted threads." },
  { id: "jev", title: "Jev", description: "Studio's fast model for small decisions, such as whether a message steers or queues." },
  { id: "advanced", title: "Advanced", description: "Tuning most people never need to change." },
];

export const STUDIO_SETTINGS = {
  // Voice
  holdToTalkKey: { group: "voice", type: "select", label: "Hold-to-talk key", description: "Hold it to dictate into the focused field. Let go to insert the text.", options: HOLD_KEY_OPTIONS, default: HOLD_KEY_OPTIONS[0] },
  replaceBuiltInDictation: { group: "voice", type: "boolean", label: "Microphone button starts Talk", description: "Every dictation is saved and can run for hours. Off uses BB’s one-shot dictation.", default: true },
  voiceLiveModel: { group: "voice", type: "select", label: "Hands-free model", description: "gpt-live-1 costs about 5¢ a minute plus a small backend model. gpt-realtime-2.1 is billed by token, about 7¢ a minute.", options: LIVE_MODELS, default: LIVE_MODELS[0] },
  voiceLiveVoice: { group: "voice", type: "select", label: "Hands-free voice", description: "The two models have different voices. marin is in both; a voice the model doesn’t have uses marin.", options: ALL_VOICES, default: DEFAULT_VOICE },
  voiceLiveBackendModel: { group: "voice", type: "select", label: "Backend model", description: "gpt-live-1 only: the model that picks tools and words the answers. gpt-5.6-luna is the cheapest and fastest.", options: BACKEND_MODELS, default: DEFAULT_BACKEND_MODEL },
  voiceLiveMonthlyCapUsd: { group: "voice", type: "number", label: "Monthly limit (USD)", description: "Studio won’t start a hands-free session once this month’s sessions reach it, and stops one that goes over. Estimated from OpenAI’s usage reports.", default: DEFAULT_CAP_USD, min: 0, max: 10_000 },
  meetingAgentName: { group: "voice", type: "string", label: "Meeting agent’s name", description: "What the meeting agent is called, shown on her screen. Saying it in the room is how you talk to her. Pick a name that’s rarely misheard as an ordinary word.", default: "Iris", maxLength: 24 },
  meetingAddressing: { group: "voice", type: "select", label: "When the meeting agent answers", description: "When someone says her name, then follow-ups for a few seconds. Or also when she judges the room clearly wants her. The Quiet button silences her either way.", options: ["name", "judge"], optionLabels: { name: "When named", judge: "When named, or when it’s clear" }, default: "name" },

  // Recordings and calls
  autoTitle: { group: "recordings", type: "boolean", label: "Name recordings", description: "Give each recording a short title once it has some text.", default: true },
  autoMeetingNotes: { group: "recordings", type: "boolean", label: "Summarize recordings", description: "Write notes when a recording ends. You can always summarize one from its menu.", default: false },
  callTranscription: { group: "recordings", type: "select", label: "Transcribe calls", description: "This Mac keeps call audio here. A home server or BB’s voice service receives each piece of audio.", options: CALL_STT_OPTIONS, optionLabels: { [CALL_STT_OPTIONS[0]]: "This Mac", [CALL_STT_OPTIONS[1]]: "Home server", [CALL_STT_OPTIONS[2]]: "BB voice service" }, default: CALL_STT_OPTIONS[0] },
  callServerUrl: { group: "recordings", type: "string", label: "Home server URL", description: "A speech-to-text server with an OpenAI-compatible /v1/audio/transcriptions endpoint, such as http://red4:8000.", default: "", maxLength: 500 },
  callServerModel: { group: "recordings", type: "string", label: "Home server model", description: "The model name the home server expects. Empty uses whisper-1.", default: "", maxLength: 200 },
  callLocalModel: { group: "recordings", type: "string", label: "Model on this Mac", description: "The WhisperKit model. It downloads the first time a call uses it.", default: "openai_whisper-large-v3-v20240930_626MB", maxLength: 200 },
  dictationAudioDays: { group: "recordings", type: "number", label: "Keep dictation audio (days)", description: "Transcripts stay. Recordings always keep their audio. 0 keeps it forever.", default: 1, min: 0, max: 3650, integer: true },
  callAudioRetention: { group: "recordings", type: "select", label: "Keep call audio", description: "Transcripts and notes stay until you delete the call.", options: CALL_RETENTION_OPTIONS, default: CALL_RETENTION_OPTIONS[1] },

  // Agent replies
  explore_next: { group: "replies", type: "boolean", label: "Next row", description: "Agents end replies with one row of next steps. Applies to sessions started after the change.", default: true },
  explore_explore: { group: "replies", type: "boolean", label: "Things to explore", description: "Agents mention a few things they noticed while reading code.", default: true },
  explore_quickReplies: { group: "replies", type: "boolean", label: "Quick replies", description: "When a reply asks you something, offer short answers.", default: true },
  explore_replyItems: { group: "replies", type: "string", label: "Your usual quick replies", description: "Emoji and label pairs, such as “👍 Looks good”, separated by commas or lines. Agents use them when they fit.", default: DEFAULT_REPLIES.join(", "), maxLength: 10_000 },
  emojiItems: { group: "replies", type: "string", label: "Reactions", description: "Up to eight emoji and label pairs, separated by commas or lines. Each drafts its label as your reply. Empty hides them.", default: DEFAULT_EMOJI_ITEMS, maxLength: 2000, multiline: true },
  showInSelectionMenu: { group: "replies", type: "boolean", label: "Show reactions when you select text", description: "In the menu that opens when you select text, and the right-click menu.", default: true },
  showInAssistantBar: { group: "replies", type: "boolean", label: "Show reactions under Studio’s replies", default: true },
  showInUserBar: { group: "replies", type: "boolean", label: "Show reactions under your messages", default: true },
  quoteSelection: { group: "replies", type: "boolean", label: "Quote the selected text", description: "So the agent sees what you reacted to.", default: true },
  quotePosition: { group: "replies", type: "select", label: "Quote position", options: ["before", "after"], optionLabels: { before: "Before the reaction", after: "After the reaction" }, default: "before" },

  // Threads
  decisions_enabled: { group: "threads", type: "boolean", label: "Smart Queue", description: "Hold a message you send to a busy thread, then steer the current turn or queue it. Pauses while the standalone Smart Queue plugin is on.", default: true },
  autoResumeThreads: { group: "threads", type: "boolean", label: "Resume after a restart", description: "A thread cut off by a BB or host restart continues on its own, up to 2 times an hour.", default: true },
  loopsEnabled: { group: "threads", type: "boolean", label: "Attention Router", description: "Collect what needs you into Loops. The daily budget and quiet hours are on the Bot page, under Controls ▸ Attention.", default: false },
  snapshotsPerPage: { group: "threads", type: "number", label: "Page history", description: "Keep this many versions of each page, or 0 for all. Older versions go the next time a page saves.", default: 50, min: 0, max: 1000, integer: true },

  // Jev
  decisions_jevProvider: { group: "jev", type: "select", label: "Jev provider", description: "Auto tries each provider with a key in order, and moves on when one fails.", options: jevProviderChoices, optionLabels: { auto: "Auto", typesafe: "TypeSafe", vercel: "Vercel AI Gateway", openrouter: "OpenRouter", "opencode-zen": "OpenCode Zen", custom: "Your own endpoint" }, default: "auto" },
  decisions_customJevEndpoint: { group: "jev", type: "string", label: "Endpoint URL", description: "Any endpoint that speaks TypeSafe’s System One API, such as https://gateway.example.com/v1/systemone. HTTPS except on localhost.", default: "", maxLength: 2000 },
  decisions_customJevApiKeyCommand: { group: "jev", type: "string", label: "Or a command that prints the key", description: "For short-lived tokens: run on the BB server; the token is reused until its JWT expires, or for five minutes.", default: "", maxLength: 2000 },
  decisions_customJevHeaders: { group: "jev", type: "string", label: "Extra headers", description: "`name: value` pairs separated by semicolons, such as `source: bb; org-id: 2`.", default: "", maxLength: 4000 },
  decisions_customJevModel: { group: "jev", type: "string", label: "Model name", description: "The model the endpoint expects, such as jev-latest.", default: "", maxLength: 200 },

  // Advanced
  decisions_batchConfidence: { group: "advanced", type: "number", label: "Smart Queue batch confidence", description: "From 0 to 1. When a thread frees up, queued follow-ups Jev is this sure belong together go as one turn. 1 sends each on its own.", default: 0.5, min: 0, max: 1 },

  // Bot ▸ Controls ▸ Attention
  loopDailyBudget: { group: "attention", type: "number", label: "Interruptions a day", description: "After this many, new loops wait in the Loops list until tomorrow.", default: 5, min: 0, max: 100, integer: true },
  loopQuietStart: { group: "attention", type: "number", label: "Quiet hours start", description: "The hour, 0 to 23, when interruptions stop.", default: 22, min: 0, max: 23, integer: true },
  loopQuietEnd: { group: "attention", type: "number", label: "Quiet hours end", description: "The hour, 0 to 23, when interruptions start again.", default: 7, min: 0, max: 23, integer: true },
} as const satisfies Record<string, StudioSetting>;

export type StudioSettingKey = keyof typeof STUDIO_SETTINGS;
type ValueOf<D> = D extends { type: "boolean" } ? boolean : D extends { type: "number" } ? number : string;
export type StudioSettingValues = { [K in StudioSettingKey]: ValueOf<(typeof STUDIO_SETTINGS)[K]> };

export const STUDIO_SETTING_KEYS = Object.keys(STUDIO_SETTINGS) as StudioSettingKey[];

/** Some settings' definitions, for the module that reads them. */
export function pickSettings<K extends StudioSettingKey>(keys: readonly K[]): { [P in K]: (typeof STUDIO_SETTINGS)[P] } {
  return Object.fromEntries(keys.map((key) => [key, STUDIO_SETTINGS[key]])) as { [P in K]: (typeof STUDIO_SETTINGS)[P] };
}

export function isStudioSettingKey(key: string): key is StudioSettingKey {
  return Object.hasOwn(STUDIO_SETTINGS, key);
}

export function settingDefaults(): StudioSettingValues {
  return Object.fromEntries(STUDIO_SETTING_KEYS.map((key) => [key, STUDIO_SETTINGS[key].default])) as StudioSettingValues;
}

/** A value for `key`, checked against its type and range; an error in plain words otherwise. */
export function checkSetting(key: string, value: unknown): { ok: true; value: SettingValue } | { ok: false; error: string } {
  if (!isStudioSettingKey(key)) return { ok: false, error: `There's no Studio setting called ${key}.` };
  const setting: StudioSetting = STUDIO_SETTINGS[key];
  switch (setting.type) {
    case "boolean":
      return typeof value === "boolean" ? { ok: true, value } : { ok: false, error: `${key} is on or off: true or false.` };
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false, error: `${key} needs a number.` };
      if (setting.integer && !Number.isInteger(value)) return { ok: false, error: `${key} needs a whole number.` };
      if (value < setting.min || value > setting.max) return { ok: false, error: `${key} goes from ${setting.min} to ${setting.max}.` };
      return { ok: true, value };
    }
    case "string":
      if (typeof value !== "string") return { ok: false, error: `${key} needs text.` };
      if (value.length > setting.maxLength) return { ok: false, error: `${key} can be at most ${setting.maxLength} characters.` };
      return { ok: true, value };
    case "select":
      return typeof value === "string" && setting.options.includes(value)
        ? { ok: true, value }
        : { ok: false, error: `${key} is one of: ${setting.options.join(", ")}.` };
  }
}

/** A command-line value as the setting's type: "true"/"on", numbers, or the text as is. */
export function parseSettingText(key: string, raw: string): { ok: true; value: SettingValue } | { ok: false; error: string } {
  if (!isStudioSettingKey(key)) return checkSetting(key, raw);
  const setting: StudioSetting = STUDIO_SETTINGS[key];
  if (setting.type === "boolean") {
    const text = raw.trim().toLowerCase();
    if (["true", "on", "yes", "1"].includes(text)) return { ok: true, value: true };
    if (["false", "off", "no", "0"].includes(text)) return { ok: true, value: false };
    return { ok: false, error: `${key} is on or off: true or false.` };
  }
  if (setting.type === "number") return checkSetting(key, raw.trim() === "" ? Number.NaN : Number(raw));
  return checkSetting(key, raw);
}

/** Stored values with defaults filled in; a stored value that no longer fits (an option removed) is dropped. */
export function effectiveSettings(stored: Record<string, unknown>): StudioSettingValues {
  const values = settingDefaults() as Record<string, SettingValue>;
  for (const key of STUDIO_SETTING_KEYS) {
    if (!Object.hasOwn(stored, key)) continue;
    const checked = checkSetting(key, stored[key]);
    if (checked.ok) values[key] = checked.value;
  }
  return values as StudioSettingValues;
}
