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
export type SettingGroup = "voice" | "recordings" | "replies" | "threads" | "windows" | "jev" | "advanced" | "attention";

interface Base { label: string; description?: string; group: SettingGroup }
export type StudioSetting = Base & (
  | { type: "boolean"; default: boolean }
  | { type: "number"; default: number; min: number; max: number; integer?: boolean }
  | { type: "string"; default: string; maxLength: number; multiline?: boolean }
  | { type: "select"; default: string; options: readonly string[]; optionLabels?: Record<string, string> }
);
export type SettingValue = boolean | number | string;

export const SETTINGS_GROUPS: readonly { id: Exclude<SettingGroup, "attention">; title: string }[] = [
  { id: "voice", title: "Voice" },
  { id: "recordings", title: "Recordings and calls" },
  { id: "replies", title: "Agent replies" },
  { id: "threads", title: "Threads" },
  { id: "windows", title: "Windows" },
  { id: "jev", title: "Jev" },
  { id: "advanced", title: "Advanced" },
];

export const STUDIO_SETTINGS = {
  // Voice
  holdToTalkKey: { group: "voice", type: "select", label: "Hold-to-talk key", options: HOLD_KEY_OPTIONS, default: HOLD_KEY_OPTIONS[0] },
  replaceBuiltInDictation: { group: "voice", type: "boolean", label: "Microphone button starts Talk", description: "Off uses BB’s one-shot dictation.", default: true },
  voiceLiveModel: { group: "voice", type: "select", label: "Hands-free model", description: "gpt-live-1 costs about 5¢ a minute plus a small backend model. gpt-realtime-2.1 is billed by token, about 7¢ a minute.", options: LIVE_MODELS, default: LIVE_MODELS[0] },
  voiceLiveVoice: { group: "voice", type: "select", label: "Hands-free voice", description: "A voice the model doesn’t have uses marin.", options: ALL_VOICES, default: DEFAULT_VOICE },
  voiceLiveBackendModel: { group: "voice", type: "select", label: "Backend model", description: "gpt-live-1 only. gpt-5.6-luna is the cheapest and fastest.", options: BACKEND_MODELS, default: DEFAULT_BACKEND_MODEL },
  voiceLiveMonthlyCapUsd: { group: "voice", type: "number", label: "Monthly limit (USD)", description: "Estimated from OpenAI’s usage reports.", default: DEFAULT_CAP_USD, min: 0, max: 10_000 },
  meetingAgentName: { group: "voice", type: "string", label: "Meeting agent’s name", default: "Iris", maxLength: 24 },
  meetingAddressing: { group: "voice", type: "select", label: "When the meeting agent answers", options: ["name", "judge"], optionLabels: { name: "When named", judge: "When named, or when it’s clear" }, default: "name" },

  // Recordings and calls
  autoTitle: { group: "recordings", type: "boolean", label: "Name recordings", default: true },
  autoMeetingNotes: { group: "recordings", type: "boolean", label: "Summarize recordings", default: false },
  callTranscription: { group: "recordings", type: "select", label: "Transcribe calls", description: "This Mac keeps call audio here. A home server or BB’s voice service receives each piece of audio.", options: CALL_STT_OPTIONS, optionLabels: { [CALL_STT_OPTIONS[0]]: "This Mac", [CALL_STT_OPTIONS[1]]: "Home server", [CALL_STT_OPTIONS[2]]: "BB voice service" }, default: CALL_STT_OPTIONS[0] },
  callServerUrl: { group: "recordings", type: "string", label: "Home server URL", description: "A speech-to-text server with an OpenAI-compatible /v1/audio/transcriptions endpoint, such as http://homelab:8000.", default: "", maxLength: 500 },
  callServerModel: { group: "recordings", type: "string", label: "Home server model", description: "Empty uses whisper-1.", default: "", maxLength: 200 },
  callLocalModel: { group: "recordings", type: "string", label: "Model on this Mac", description: "The WhisperKit model.", default: "openai_whisper-large-v3-v20240930_626MB", maxLength: 200 },
  dictationAudioDays: { group: "recordings", type: "number", label: "Keep dictation audio (days)", description: "0 keeps it forever.", default: 1, min: 0, max: 3650, integer: true },
  callAudioRetention: { group: "recordings", type: "select", label: "Keep call audio", options: CALL_RETENTION_OPTIONS, default: CALL_RETENTION_OPTIONS[1] },

  // Agent replies
  explore_next: { group: "replies", type: "boolean", label: "Next row", description: "Applies to sessions started after the change.", default: true },
  explore_explore: { group: "replies", type: "boolean", label: "Things to explore", default: true },
  explore_quickReplies: { group: "replies", type: "boolean", label: "Quick replies", default: true },
  explore_replyItems: { group: "replies", type: "string", label: "Your usual quick replies", description: "Emoji and label pairs, such as “👍 Looks good”, separated by commas or lines.", default: DEFAULT_REPLIES.join(", "), maxLength: 10_000 },
  emojiItems: { group: "replies", type: "string", label: "Reactions", description: "Up to eight emoji and label pairs, separated by commas or lines. Empty hides them.", default: DEFAULT_EMOJI_ITEMS, maxLength: 2000, multiline: true },
  showInSelectionMenu: { group: "replies", type: "boolean", label: "Show reactions when you select text", description: "In the menu that opens when you select text, and the right-click menu.", default: true },
  showInAssistantBar: { group: "replies", type: "boolean", label: "Show reactions under Studio’s replies", default: true },
  showInUserBar: { group: "replies", type: "boolean", label: "Show reactions under your messages", default: true },
  quoteSelection: { group: "replies", type: "boolean", label: "Quote the selected text", default: true },
  quotePosition: { group: "replies", type: "select", label: "Quote position", options: ["before", "after"], optionLabels: { before: "Before the reaction", after: "After the reaction" }, default: "before" },

  // Threads
  decisions_enabled: { group: "threads", type: "boolean", label: "Smart Queue", description: "Pauses while the standalone Smart Queue plugin is on.", default: true },
  autoResumeThreads: { group: "threads", type: "boolean", label: "Resume after a restart", description: "Up to 2 times an hour.", default: true },
  loopsEnabled: { group: "threads", type: "boolean", label: "Todos", description: "The daily budget and quiet hours are on the Bot page, under Controls ▸ Attention.", default: false },
  snapshotsPerPage: { group: "threads", type: "number", label: "Page history", description: "Keep this many versions of each page, or 0 for all.", default: 50, min: 0, max: 1000, integer: true },
  exportDeletedThreads: { group: "threads", type: "boolean", label: "Export deleted threads", description: "If the file cannot be written, the thread is not deleted.", default: false },
  exportDeletedThreadsFolder: { group: "threads", type: "string", label: "Export folder", description: "An absolute folder path on the BB server, such as /Users/you/bb-thread-exports. One .jsonl file per thread.", default: "", maxLength: 500 },

  // Windows (only a BB with plugin windows uses them; src/launcher)
  launcherHotkey: { group: "windows", type: "string", label: "Launcher shortcut", description: "Written like Alt+Space or Control+Shift+L. Empty for none.", default: "Alt+Space", maxLength: 40 },

  // Jev
  decisions_jevProvider: { group: "jev", type: "select", label: "Jev provider", options: jevProviderChoices, optionLabels: { auto: "Auto", typesafe: "TypeSafe", vercel: "Vercel AI Gateway", openrouter: "OpenRouter", "opencode-zen": "OpenCode Zen", custom: "Your own endpoint" }, default: "auto" },
  decisions_customJevEndpoint: { group: "jev", type: "string", label: "Endpoint URL", description: "Any endpoint that speaks TypeSafe’s System One API, such as https://gateway.example.com/v1/systemone. HTTPS except on localhost.", default: "", maxLength: 2000 },
  decisions_customJevApiKeyCommand: { group: "jev", type: "string", label: "Or a command that prints the key", description: "Run on the BB server; the token is reused until its JWT expires, or for five minutes.", default: "", maxLength: 2000 },
  decisions_customJevHeaders: { group: "jev", type: "string", label: "Extra headers", description: "`name: value` pairs separated by semicolons, such as `source: bb; org-id: 2`.", default: "", maxLength: 4000 },
  decisions_customJevModel: { group: "jev", type: "string", label: "Model name", description: "The model the endpoint expects, such as jev-latest.", default: "", maxLength: 200 },

  // Advanced
  decisions_batchConfidence: { group: "advanced", type: "number", label: "Smart Queue batch confidence", description: "From 0 to 1. When a thread frees up, queued follow-ups Jev is this sure belong together go as one turn. 1 sends each on its own.", default: 0.5, min: 0, max: 1 },

  // Bot ▸ Controls ▸ Attention
  loopDailyBudget: { group: "attention", type: "number", label: "Interruptions a day", description: "After this many, new todos wait in the Todos list until tomorrow.", default: 5, min: 0, max: 100, integer: true },
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
    case "select": {
      const known = typeof value === "string" ? setting.options.find((option) => option === value || value.startsWith(`${option} (`)) : undefined;
      return known !== undefined
        ? { ok: true, value: known }
        : { ok: false, error: `${key} is one of: ${setting.options.join(", ")}.` };
    }
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
