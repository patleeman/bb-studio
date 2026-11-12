# Removing the old in-thread voice mode

The old voice mode turns on in any thread: speech to text, then the thread,
then text to speech of its reply. Hands-free voice
([spike.md](spike.md)) replaces it. **Dictation stays.**

Patrick approved this list as recommended, and it was **removed on Nov 1**,
Read aloud included. The speech-only OpenRouter key went with it (Jev keeps
its own `openRouterApiKey`), and iOS Talk to Bot (the Action button,
`TalkToChiefIntent`, `bbstudio://bot-talk` and `chief-talk`) now opens
hands-free voice and starts the session at once. `docs/ios/no-voice-chat/`
stays as history. The list was made from `origin/main` at `6848aa94`.

## What hands-free voice shares with it

- **`speakable()`** in `packages/bb-studio/src/voice/instructions.ts`. The voice
  tool layer (`src/voice/live/live.ts`) uses it to cut thread replies down for
  speaking. Move it into `src/voice/live/` (as `speakable.ts`) before deleting
  `instructions.ts`.
- **The retired Call's tables** (`voice_calls`, `voice_call_events`). These
  belong to the old Call, not voice mode, and their migration has to stay.
- **iOS `Speakable.text`** (in `iOS/Voice/VoiceText.swift`). Siri's "Ask BB"
  and "Ask Bot" intents (`iOS/App/Intents.swift`) use it to speak replies. Keep
  it: move it out of `iOS/Voice/` before deleting the folder.
- **Nothing else.** Hands-free voice speaks through OpenAI, so it doesn't use
  `src/speech/` (Studio's TTS engines), the `voice.*` or `speech.*` RPCs, voice
  mode's agent tools, or any of `iOS/Voice/`.

## Desktop (packages/bb-studio)

### Settings

Remove all of these from Studio's settings (`src/speech/settings.ts`,
`SPEECH_SETTINGS`, spread into `bb.settings.define` in `server.ts`):

| Key | What it set |
| --- | --- |
| `speechEngine` | OpenRouter, custom endpoint, or local on this Mac |
| `speechModel` | The TTS model (default `fish-audio/drama-3`) |
| `speechVoice` | The voice |
| `speechInstructions` | Style instructions for the voice |
| `speechSpeed` | Playback speed |
| `openRouterApiKey` | The OpenRouter key. Named for Studio "so other features can share it later", but **only speech uses it today.** Remove it, or keep it as a spare key. |
| `speechEndpoint`, `speechEndpointApiKey` | The custom OpenAI-compatible TTS server |

Also remove **Setup → Speech** (`src/ui/setup/SpeechSection.tsx`, and its entry
in `src/ui/setup/SetupPage.tsx` and its test), with the local engine's
install, status and sample player.

### Buttons and commands

- **The composer's voice control, beside the mic**
  (`app.composer.customize({ id: "voice" … })` in `src/voice/ui/register.tsx`).
  It's the speaker button with the ✕ when off and its dropdown (speed,
  conversational), the push-to-talk and hands-free pill, the Bot's speaking
  bars with Stop, and the "Hold to talk · long-press for hands-free" hint
  banner. **This slot is where the hands-free button goes.**
- **"Read aloud" under every reply** (`app.slots.messageAction({ id: "read-aloud" })`).
- **The command "Voice mode: turn on or off in this thread"**
  (`app.commands.register({ id: "toggle-voice" })`).

### Code

- `src/voice/register.ts`, `sessions.ts`, `contract.ts`, `shared.ts`,
  `instructions.ts` (after moving `speakable`), and their tests.
- `src/voice/ui/register.tsx`, `state.ts`, `voice-input.ts` (the
  `SpeechGate` energy gate), `read-along.ts`, and their tests.
- `src/voice/ui/dictation-recovery.ts`: only the voice composer uses it. Talk's
  own dictation recovery is in `src/talk/`.
- `src/speech/` entirely: `engines`, `local` (mlx-audio: Kokoro, Qwen3-TTS,
  Chatterbox), `service`, `chunks`, `speaker`, `register` (with its
  `GET /speech` audio route), `settings`, `contract`, and tests. Nothing outside
  voice mode and Setup → Speech imports it.
- `server.ts`:
  - `registerSpeech(...)`;
  - `registerVoice(...)`;
  - the `voice` handle;
  - in `bb.agents.configure`, voice mode's instructions and its unseen
    per-turn note (`voice?.configure(...)`).
- `app.tsx`: `registerVoiceApp(app)`.
- **Talk's hook for voice mode** (`src/talk/ui/controller.ts`): the
  `voiceDictation` interface (`wants`, `deliver`, `dictating`) and the branches
  that use it (around lines 281, 618, 734 and 1230). Dictation itself stays
  as it is.
- `app.tsx` / `package.json` icons `studio/speaker` and `studio/speaker-off`,
  if nothing else uses them by then.

### RPCs and contract entries

- `voice.state`, `voice.set`, `voice.conversational`, `voice.turnNote`
  (`src/voice/contract.ts`).
- `speech.state`, `speech.update`, `speech.models`, `speech.prepare`,
  `speech.local` (`src/speech/contract.ts`).
- Drop both from `src/public-contract.ts`, then run `gen-contracts` to update
  `contracts/studio.schema.json`, `ios/Shared/Generated/StudioContract.swift`
  and `contracts/native-rpc-inventory.json`.
- The realtime channel `VOICE_REALTIME_CHANNEL` (spoken replies).

### Agent tools

These are only available in a voice-mode thread: `voice_delegate`,
`voice_threads`, `voice_read`.

### Docs and captures

- `packages/bb-studio/README.md`: Setup → Speech (around lines 2351–2400),
  and Voice mode (around 2416–2450), with their screenshots in `assets/`.
- `scripts/capture/captures/bb-studio.mjs`: the voice-mode and Speech
  captures.
- `docs/ios/no-voice-chat/` (the earlier removal of New voice chat): keep it as
  history, or remove it.

## iOS (ios)

### Settings

- **Settings → Voice** (`SpeechSettingsView`, opened from
  `iOS/App/SettingsView.swift`; also listed in `iOS/App/RegularPages.swift`):
  the engine, model, voice and speed, using `speech.*`.

### Buttons and gestures

- **The speaker beside the composer's mic, and its menu** (voice mode on or
  off, speed). The talk pill's voice-mode states: push to talk, hands-free,
  and the Bot speaking with Stop.
- **"Read Aloud" / "Stop Reading" in a message's long-press menu**
  (`iOS/Thread/Messages.swift`).
- **The `bbstudio://voice/<id>` deep link** (opens a thread with voice mode
  on) in `AppModel.handle`.
- **"Talk to Bot"** (`TalkToChiefIntent`, the Action button, and
  `bbstudio://bot-talk` / `chief-talk`, through `AppModel.toggleBotTalk` and
  `botTalkPending`) starts a voice-mode talk in the Bot's chat. **Decide:**
  remove it, or point it at hands-free. Pointing it at hands-free is the spec's
  P2 ("Talk to BB").

### Code

- `iOS/Voice/ThreadVoice.swift`, `VoicePlayer.swift`, `VoiceViews.swift`,
  `VoiceText.swift` (after moving `Speakable`).
- `iOS/Voice/ComposerVoice.swift`: **keep the dictation part.** It's "the
  composer's one mic and one indicator, across dictation and voice mode", so
  remove the voice-mode states and keep the mic and Listening indicator. The
  energy gate (speech above 0.35, barge-in above 0.45) goes with voice mode.
- `Shared/BBClient+Voice.swift` (the `voice.*` and `speech.*` calls).
- `iOS/Thread/ThreadView.swift`:
  - `voice: ThreadVoice`;
  - `player: VoicePlayer`;
  - `VoiceHooks`;
  - `readAlongRow`, `editingVoice`;
  - the Action-button take-over, if Talk to Bot goes.
- **Read-along** (it only exists for voice mode):
  - `readAlongPiece` and `ReadAlongBlocks` in `iOS/Thread/Markdown.swift`;
  - `readAloud` and `readAlong` in `iOS/Thread/ThreadTranscriptV2.swift`.
- **Kept:** `HoldToTalk` and `TalkRecorder` (dictation). `VoiceAudioConfig`
  (iOS/VoiceLive) is shared by Talk and hands-free.

### Tests

- `Tests/VoiceTests.swift`: the parts that test voice mode (`Speakable` tests
  move with `Speakable`).
- `Tests/ComposerVoiceTests.swift`: keep the dictation cases.
- UI tests that use `-qaVoice …` states.

### Docs

- `ios/README.md`:
  - the Voice mode section (around line 252);
  - the composer row's voice-mode sentences;
  - Read Aloud in the long-press row;
  - the `iOS/Voice` row;
  - `voice/<id>` and `bot-talk` in the URL-scheme row.
- `ios/docs/voice/` (19 composer and speaking screenshots).

## Read-aloud: only for voice mode?

**Yes, on both platforms.**
- **Desktop:** "Read aloud" (the message action) plays through voice mode's
  player (`voicePlayer.readAloud`) and Studio's TTS (`speech.prepare`), and the
  read-along highlight is `src/voice/ui/read-along.ts`.
- **iOS:** "Read Aloud" exists only "with Studio's voice mode", through
  `ThreadVoice` and `VoicePlayer`, and its read-along highlight is the
  Markdown and transcript plumbing above.

Removing voice mode removes read-aloud, unless Patrick wants to keep it as its
own feature. If he does, it needs `src/speech/` (the TTS engine and its
settings) on desktop, and `VoicePlayer`'s piece playback on iOS.
