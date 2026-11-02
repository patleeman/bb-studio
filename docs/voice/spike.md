# Hands-free voice: spike

The spike behind the spec page "Voice mode: hands-free spec"
(`pg_f8d1db21d65e3388`), built on Patrick's decisions: a separate voice agent
that relays visibly to the CoS and threads, GPT-Live first with Realtime as the
fallback, eyes-free rules enforced in Studio, Bluetooth mic routing, and an iOS
screen with a talking icon and subtitles. CarPlay is on hold. This is a spike:
it isn't merged or released.

**Status, Nov 1.** It ran live against the real `gpt-live-1`, with Studio's
real tool layer and the real iOS app in a simulator (see "Live run" below):
"what's waiting", a relay to the Kensico lead (then still with a read-back and
a spoken "yes" that Studio checked; relays are now instant, see the rules), the
lead's reply read back, and a barge-in. The key
came through `bb secret request` into a staged-only dotenv, and was used only
by the harness process on this Mac. **Still untested live: the phone's own
WebRTC connection.** The live run used GPT-Live's WebSocket transport from the
host instead, because a mic in the simulator is the Mac's mic and would raise
a macOS microphone prompt.

## What was built

| Piece | Where |
| --- | --- |
| Studio relay: `voiceLive.*` RPCs, session start (GPT-Live SDP exchange or a Realtime client secret), the tool layer with the eyes-free rules, the voice thread, replies, the cap | [`packages/bb-studio/src/voice/live/`](../../packages/bb-studio/src/voice/live/) |
| Prices: the Realtime table restored from the retired Call, plus GPT-Live's per-second price | [`bot-prices.ts`](../../packages/bb-studio/src/bot-prices.ts) |
| iOS core (Swift 6 clean, no app imports): wire events, session state machine, audio session config | [`apps/ios/iOS/VoiceLive/Core/`](../../apps/ios/iOS/VoiceLive/Core/) |
| iOS app: WebRTC and mock transports, controller, screen, `-qaVoiceLive` demo states | [`apps/ios/iOS/VoiceLive/`](../../apps/ios/iOS/VoiceLive/) |
| Talk dictation's Bluetooth fix (HFP) | [`TalkRecorder.swift`](../../apps/ios/iOS/Talk/TalkRecorder.swift) |
| Scripted GPT-Live mock with Studio's real tool layer | [`packages/bb-studio/scripts/voice-mock/server.ts`](../../packages/bb-studio/scripts/voice-mock/server.ts) |

Entry: a waveform button in the Bot tab's header, or `bbstudio://handsfree`.
You tap Start once. After that, nothing needs a tap until End.

## Transport

**WebRTC for both models**, with the key only on the BB host.

- **gpt-live-1 (first choice).** GPT-Live has **no client secrets**: the
  server creates the session. The phone makes its WebRTC offer and sends it to
  `voiceLive.start`. Studio posts it with its key to
  `POST /v1/live/sessions` (`session` + `transport: {type: "webrtc", sdp}`)
  and returns OpenAI's SDP answer. The phone never holds any credential, not
  even a short-lived one. Audio goes over the media tracks and events over the
  `oai-events` data channel.
- **gpt-realtime-2.1 (fallback).** This is the retired Call's flow: Studio
  mints a 2-minute client secret (`/v1/realtime/client_secrets`) that carries
  the whole session, and the phone posts its SDP to `/v1/realtime/calls`. Turn
  detection is now `semantic_vad` with `interrupt_response`.
- **Today's pipeline** (batch speech to text, the full thread turn, then text
  to speech) stays as the no-key option. This spike doesn't touch it.
- **The mock.** When the host sets `STUDIO_VOICE_MOCK_URL`, `voiceLive.start`
  answers `transport: "mock"` without a key and never calls OpenAI. The phone
  then opens a WebSocket that speaks GPT-Live's events, plus the voice's audio
  as PCM. The app's WebRTC code compiles and is wired in, but it has only run
  against the mock's WebSocket path, never against OpenAI.

iOS uses `stasel/WebRTC` 156 (an M156 xcframework of about 46 MB) through
SwiftPM. In this sandbox the SwiftPM artifact download hung, so the build
used the same zip fetched with curl, checksum verified, through SwiftPM's
artifact cache. A normal machine downloads it by itself.

## Tools and how GPT-Live delegation was used

What the docs say (checked Nov 1:
[model](https://developers.openai.com/api/docs/models/gpt-live-1),
[delegation](https://developers.openai.com/api/docs/guides/live-delegation),
[WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live),
[sessions](https://developers.openai.com/api/docs/guides/live-conversations)):

- **Two delegation modes**, fixed when the session is created:
  - **`responses`**: GPT-Live calls a Responses model you configure, with its
    own instructions and tools. Hosted tools (web search, file search, code
    interpreter and more) run at OpenAI. **Function tools come back to you** as
    `response.event` envelopes holding `response.output_item.done` with a
    `function_call`. You answer with `response.item.create`
    (`function_call_output`, matched by `call_id`) and then `response.create`.
  - **`client`**: each turn becomes `session.delegation.created` **with no task
    text**. Your app rebuilds the request from transcript deltas, runs its own
    agent, and speaks results back with `session.commentary.append` (at most 500
    tokens). This is what Hermes Agent uses.
- **The live model itself has no tools.** Tools live in the backend
  (`responses`) or in your agent (`client`).
- **No barge-in event.** GPT-Live is full duplex and handles interruption on
  the server, but the docs describe no "speech started" or "truncated" event.
  Transcript deltas (`session.input_transcript.delta` and the output one) carry
  `start_ms` and `end_ms`, but no item ID and no end-of-turn marker.
- **Usage**: `session.usage.updated` reports cumulative `seconds`, and
  `session.closed` has the final total with a `reason`.
- **Voices**: GPT-Live has its own list (quartz, ripple, vesper and others) and
  defaults to marin. The spike uses marin for both models.
- **Server-side control**: a sideband WebSocket can watch and steer a session
  from the server, but the spike doesn't use it.

**The spike uses `responses` delegation with Studio's function tools.** The
backend is `gpt-5.6-luna`, with `parallel_tool_calls: false` so a confirm always
lands after its draft. The tool calls arrive on the phone's data channel. The
phone passes each one to `voiceLive.tool` along with the transcript lines heard
so far, and returns Studio's answer. Direct server-side delegation (Studio
receiving the calls without the phone) would need the sideband connection. It
is the obvious next step, because tools would keep working if iOS suspended
the app's networking, and it would save one hop. `client` delegation would mean
running our own agent per turn, so it's slower and costs more than a small
Responses model that only picks tools.

The tools are:
- **reads:** `loops_list`, `read_replies`;
- **at once:** `send_to_cos`, `send_to_thread` (by name, or "the X lead"),
  `loops_act` (done, snooze, hand off), `loops_add`, `undo`;
- **after a spoken yes:** `loops_act` drop, `stop_thread`, `archive_thread`,
  `pause_automation`, `delete_automation`, answered with `confirm` or `cancel`.

## Eyes-free rules, enforced in the tool layer

Patrick's rule (Nov 1, replacing "read back every send"): **act at once, say it
briefly; confirm only what's destructive or hard to undo.** Every tool call is
classified in [`rules.ts`](../../packages/bb-studio/src/voice/live/rules.ts)
(`classify`) and enforced in [`live.ts`](../../packages/bb-studio/src/voice/live/live.ts),
not just in the prompt. Tests are in `live.test.ts` and `rules.test.ts`.

| Class | Tools | How Studio enforces it |
| --- | --- | --- |
| **Read**, free | `loops_list`, `read_replies` | Read-only; tests check they write nothing. |
| **At once**, said briefly | Relays: `send_to_cos`, `send_to_thread`. Loop actions: done, snooze, hand off (`loops_act`), add (`loops_add`) | A relay is sent right away, visible in the target thread **from the voice thread** (`senderThreadId`), and posted in the voice thread. Studio answers "Sent to the Kensico lead." and the voice says just that; the phone shows "✓ Sent to the Kensico lead" under the subtitles. Loop actions run at once with a **spoken 10 s undo** (`undo` restores status, trigger and owner; undoing an add removes the loop). |
| **Confirm**, destructive or hard to undo | Drop a loop (`loops_act` drop), `stop_thread`, `archive_thread`, `pause_automation`, `delete_automation` | Nothing happens yet. Studio returns one question ("Drop the loop 'Remove the stale Tailscale node'? Say yes to drop."), the voice asks it, and the phone shows **"Waiting for your yes"**, the only place that card appears. `confirm` acts only if Studio's own transcript has a **user line after the question** that is a short, clear yes ("Yes, drop it" counts). A yes said before the question doesn't count. A no or a change cancels. Whisper's filler ("Thank you for watching") and the voice's own question echoed into the mic aren't a yes. It expires after 45 s. The model saying "they said yes" counts for nothing. |
| **Never by voice** | Spending money, email or messages to people outside BB, posting publicly, approving credentials | No such tools exist, and an unknown tool name gets a refusal. A relay that *asks* for one is still sent, as a request. It's marked "⚠️ Voice can't approve this: ask me here first", and an agent-only note on every relay tells the target not to act on the voice's word for any of them. |

## The voice thread

Each session opens a BB thread in the personal project ("🎙 Voice · Nov 1, 5:35
PM"). Each post there is a `threads.send` with an agent-only "[PASS]" note,
because the SDK can't append a message without starting a turn, so posts are
kept to the minimum:

- **Every relay, as it happens:** one line, "→ Sent to the Kensico lead: …".
- **The full transcript once, at hang-up:** a summary line, then both sides'
  words in order, interruptions, what was sent and what came back, the loop
  actions ("✓ Loop done: …") and anything done after a spoken yes ("⚠️ Done
  after a spoken yes: Dropped the loop '…'.").
- **A reply that arrives after hang-up:** one line, plus the phone push.

Nothing else is posted while the session runs: no transcript batches, and
replies during the session go into the end transcript (`live.test.ts`, "the
voice thread"). A session with one relay costs two short turns there. The
voice thread from the recorded mock session is saved as `mock-voice-thread.md`
in the deliverables folder.

## Barge-in and the subtitle UI

- **Barge-in, by level first.** While the voice plays, the phone watches the
  mic level ([`BargeInGate.swift`](../../apps/ios/iOS/VoiceLive/Core/BargeInGate.swift)).
  On the phone, the levels are WebRTC's `audioLevel` stats every 50 ms: the mic
  (`media-source`, after echo cancellation) and the voice (`inbound-rtp`).
  - **When it triggers.** The level must stay above a bar for 120 ms. The bar
    is 0.02 RMS when the voice is quiet. While the voice plays it is the higher
    of 0.035 and half the voice's playback level plus 0.02, so the voice's own
    echo can't trigger it.
  - **What happens.** The phone mutes the voice's track at once
    (`isEnabled = false`; in the mock it stops the player). Nothing is sent to
    the model yet.
  - **The transcript decides.** Words arriving confirm the barge-in. Then the
    phone sends the silent note with what the user heard ("The user interrupted
    you. They heard up to: '…'"; `session.thinking.append` for Live, a system
    item for Realtime), and the rest of the cut-off reply isn't shown or played.
    If no words come within 1 s of the user's level dropping back, it was a
    false alarm (a cough, a bump): the voice is unmuted and carries on. While
    muted it skips that stretch, because WebRTC can't pause a live stream.
  - **Why the window starts when the level drops.** GPT-Live's transcript of
    the user lags about 2.4 s while the voice talks. A window counted from the
    trigger cancelled a real barge-in in testing.
  - **Without levels** (the scripted mock, or no stats), the first transcript
    word still barges in on its own. The voice's own words echoing back into
    the mic don't trigger it.
- **Subtitles.** A talking icon moves while either side speaks: teal for you,
  the app's accent for the voice, and purple while thinking. Under it, the
  current line streams in large type, not chat bubbles, and keeps its newest
  words in view. A relay shows "✓ Sent to …" as a line under the subtitles.
  "Waiting for your yes" appears only for a destructive action. Other tool
  results show as one small card.
- **Earcons** play for start, heard, working, sent, error and end.
- **Audio session.** One `.playAndRecord` / `.voiceChat` session runs from Start
  to End, with `.allowBluetoothHFP`, A2DP, `bluetoothHighQualityRecording`,
  `.defaultToSpeaker` and `.duckOthers`. It adds far-field input on iOS 26.2+,
  echo-cancelled input where available, and car or HFP input preferred. Route
  changes pick the new input. A phone call pauses the session and resumes it,
  and nothing ever falls back to push to talk.
- **Background.** The `audio` background mode was already on, and a live
  WebRTC session keeps the app running. The screen's idle timer is off while
  live.

**Talk's HFP fix.** `TalkRecorder` now sets `VoiceAudioConfig.dictation`
(HFP and A2DP, wide-band, headset or car input preferred) before the engine
starts. Switching mid-start was what stalled it. It also adds a route-change
observer that picks the new input.

## Measured latency

**Mock, iPhone 17 Pro simulator (iOS 27.0), Studio's tool layer through the
mock server, all local:**

| What | Measured |
| --- | --- |
| Studio's tool layer (`VoiceLive.tool`, including the eyes-free checks) | 1–3 ms |
| Tool round trip: the call reaches the phone → `voiceLive.tool` → result back on the channel | 20–29 ms (4 calls) |
| Barge-in: the user's first transcript delta reaches the phone → the phone has muted and its "interrupted" note reaches the server | ~1 ms (local; the mute itself happens on the phone before the note goes out) |
| A thread's reply to the voice speaking it | about 2.6 s after the reply. That is mostly the phone's 3 s reply poll; a realtime push would remove it. |

The voice's turn timing in the mock is scripted, so it says nothing about
GPT-Live's speed.

### Live run (gpt-live-1, Nov 1)

**Setup.** `scripts/voice-mock/server.ts --live` opened a GPT-Live session from
the host over its WebSocket transport (`wss://api.openai.com/v1/live/sessions`,
`session.start` with the same session config Studio sends, `responses`
delegation to `gpt-5.6-luna` with Studio's tools). The user was macOS `say`
speech streamed as a continuous mic: silence between lines, 24 kHz PCM in
100 ms chunks. The real iOS app in the simulator (iPhone 17 Pro, iOS 27.0) got
GPT-Live's events and audio through the bridge. It relayed the tool calls to
Studio's tool layer, ran the subtitles and did the barge-in mute. Times are on
the host's clock. "First word" is when speech starts in the clip that was sent.

| What | Measured |
| --- | --- |
| Connect to `session.started` | 0.25 s (WebSocket from the host) |
| User's first word → first input transcript word, a normal turn | 0.87–1.18 s (5 turns) |
| End of the user's speech → the voice's first audio, **turn latency** | 1.24–1.97 s. "What's waiting" 1.75 s, the send request 1.66 s, "Yes, send it" 1.97 s, the long question 1.24 s and the goodbye 0.75 s. Each of the first four includes a tool call; the voice often says a short "Checking now" or "Okay" first. |
| The user's last word → the backend's tool call | about 0.7 s (from the first probe: last transcript word to `function_call` done) |
| Tool round trip: the call reaches the app → Studio's tool layer → the result is back on the channel | 21–31 ms (4 calls, simulator and host) |
| Studio's tool layer itself | 0–4 ms |
| The tool result → the voice's answer starts | about 1.5 s (a second backend turn writes it, then the voice says it) |
| **Barge-in: first word → voice muted on the phone** | First run, transcript only: **2.05 s**. The first input transcript word took 2.05 s while the voice was talking (against about 1 s on a quiet line), and the app muted 2 ms after it arrived. **With the level gate: 0.20 s and 0.18 s** (two cut-ins, no false triggers), and the transcript confirmed each 1.2 s and 1.4 s after the first word. |
| Barge-in: first word → GPT-Live stops sending the voice's audio | 3.06 s (the phone had already silenced it by then) |
| The lead's reply → the voice says it | It was spoken right after "Sent." (the 3 s reply poll, then `session.commentary.append`) |
| Session cost | ≈ $0.06 for 69 s (Studio's own estimate from `session.usage.updated` and the backend's tokens) |

**The relay, live** (under the earlier read-back rule; relays are now instant). The user said "Tell the Kensico lead to pause the eBay
fetcher until Monday". The backend called `send_to_thread`; Studio drafted it
and returned the read-back, and the voice said it word for word: "Send to the
Kensico lead: Please pause the eBay fetcher until Monday. Say yes to send." The
user said "Yes, send it". The backend called `confirm_send`, and Studio found
the yes in its own transcript after the draft and sent it, from the voice
thread. The fake lead answered 2.5 s later, and the voice said: "The Kensico
lead says the eBay fetcher is paused, and it'll resume Monday at 9."

**What this says.**
- **Turns are fine for driving:** about 1.2–2 s from the end of speech to the
  voice, tool calls included.
- **Barge-in was the weak spot, so it now goes by level.** While GPT-Live is
  talking, its input transcript runs about 2 s behind the user, and GPT-Live's
  own stop came about 3 s after the user started. Muting on the first
  transcript word took 2.05 s. With the level gate, the phone mutes about 0.2 s
  after the first word, and the transcript only confirms.
- **How the level run worked.** In the harness, the mic level is the bridge's
  synthetic user plus a simulated echo residual of 35% of the voice's level
  (pessimistic for WebRTC's AEC). The app's gate, machine and mute path are the
  real ones; real phone levels come from WebRTC stats and haven't been tried on
  a device yet.
- **What matched the docs:** the event shapes (`session.delegation.created`,
  `response.event` wrapping Responses events, `response.item.create` plus
  `response.create` for tool results, `session.thinking.append`/`appended`,
  `session.usage.updated` every 15 s, and `session.closed` with
  `close_requested`) and the `marin` voice.
- **What the docs don't say:** GPT-Live **streams output audio all the time,
  silence included**, so "the voice is talking" has to come from the audio
  level or the transcript, not from audio arriving. Its replies also pause up
  to about 0.7 s between phrases.

**Fixed after the run.** The read-back had a double period because the model
ended the message with one ("Monday.. Say yes"). The voice's lines also split
at GPT-Live's phrase pauses. Lines now stay open 0.9 s, the bridge waits 0.9 s
of silence, and both fixes have tests.

## Cost per minute

| Model | Price | Per minute |
| --- | --- | --- |
| gpt-live-1 | $0.05/min of voice, billed per second (a WebRTC session bills 15 s at start, credited once it runs), plus the backend's tokens | **≈ $0.05/min**. The backend `gpt-5.6-luna` costs about $0.0001 per tool turn at about 900 tokens in and 40 out. The 47 s mock session came to ≈ $0.04. |
| gpt-realtime-2.1 | By token: audio $32 in and $64 out per million, plus transcription | ≈ $0.07/min, the retired Call's Oct 20 estimate |

The monthly cap defaults to $20 (setting: "Hands-free voice: monthly cap"),
which is about 400 minutes of GPT-Live. Studio refuses to start a session at the
cap. `voiceLive.event` returns `stop` once a running session crosses it, and the
phone says why and hangs up. The voice thread's "[PASS]" turns aren't counted:
they run on that thread's own model.

## What the old voice mode still provides

The old in-thread voice mode (speech to text, then the thread, then text to
speech) is due to be removed, while dictation stays. **The new agent doesn't
use that mode's code paths.** To keep the removal list accurate, here is all it
shares:

- **Studio:** only `speakable()` from `src/voice/instructions.ts`, used to cut
  thread replies down for speaking. Move it into `src/voice/live/` when voice
  mode goes. It doesn't use `voice/sessions.ts`, `voice/register.ts`
  (`voice_delegate`, `voice_threads`, `voice_read`, `voice.turnNote`), the
  `voice.*` RPCs, `src/speech/` or Talk's segment pipeline. It reuses the
  **retired Call's** tables (`voice_calls`, `voice_call_events`; the migration
  had to stay anyway), not voice mode's state.
- **iOS:** none of `iOS/Voice/` (ComposerVoice, ThreadVoice, VoicePlayer,
  VoiceText, VoiceViews). `VoiceAudioConfig` lives in `iOS/VoiceLive/Core` and
  is shared with Talk dictation, which stays.

## Risks

- **The phone's WebRTC path hasn't run live.** The live run used GPT-Live's
  WebSocket transport from the host. Studio's `/v1/live/sessions` SDP exchange
  and the app's WebRTC transport need a real device (or a simulator allowed to
  use the Mac's mic).
- **Barge-in thresholds aren't tuned on a device.** The gate's bar (half the
  voice's level plus 0.02, 120 ms) was checked against a simulated echo, not a
  real phone speaker, a car or HFP. Too low, and road noise or the radio mutes
  the voice for a second (it then comes back); too high, and the user waits for
  the transcript (about 2 s). Tune it on a device with WebRTC's real
  `audioLevel` stats.
- **Echo and car noise.** `.voiceChat` AEC and the transcript echo guard aren't
  tested with real audio, a car or HFP. The yes check fails safe: unclear or
  hedged speech isn't a yes.
- **Tool calls go through the phone.** If iOS throttles the app's networking,
  tools stall. Studio receiving them over the server sideband is the fix.
- **Voice thread cost.** Each relay and the end transcript each run one
  "[PASS]" turn there. An SDK "append without a turn" would remove them, but
  nothing goes upstream for now. If the app dies before End, the transcript
  isn't posted (the lines are still in Studio's tables).
- **Reply matching.** The first finished turn on a target thread after a send
  counts as its reply, even if the thread was already busy with something else.
  Voice mode's `client/turn/requested` check is the fix.
- **Reply delay.** Replies are polled every 3 s. Studio already publishes
  `VOICE_LIVE_CHANNEL`, so the phone could subscribe to it instead.
- **No transcript page.** The old Call saved a page at hang-up; the spike
  keeps the record in the voice thread only.
- **Not built: P2 items.** No Live Activity, Siri or Action-button start, or
  CarPlay (on hold).
- **WebRTC binary.** About 46 MB added to the app, from a third-party build of
  Google's WebRTC.

## How to run it

- Studio: `cd packages/bb-studio && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vitest run src/voice/live`
- iOS core in Swift 6: `apps/ios/scripts/check-voice-live-swift6.sh`
- iOS tests: `VoiceLiveMachineTests`, `VoiceLiveEventTests`, `VoiceAudioSessionTests`
- Each screen state offline:
  `-qaBotDemo chat -qaStateDemo none -qaVoiceLive idle|listening|user|speaking|tool|confirm|sent|reply`
- A scripted session:
  1. Run `../../node_modules/.bin/tsx scripts/voice-mock/server.ts --port 8790 --out <dir>` from `packages/bb-studio`.
  2. Launch the app with `-qaVoiceLive script -qaVoiceLiveStudio http://127.0.0.1:8790 -qaVoiceLiveAutostart`.
- Live, from the host: with `OPENAI_API_KEY` in a staged-only dotenv, run
  `(set -a; . <dotenv>; set +a; ../../node_modules/.bin/tsx scripts/voice-mock/server.ts --live --port 8790 --out <dir>)`
  and launch the app as for the scripted session. It writes
  `live-timings.json`, `live-audio.wav` (both sides) and `live-events.jsonl`.
- Live, on a phone: put the key in Studio's settings and set "Hands-free voice:
  model". Not tried yet.

## Deliverables

In `/Users/patrick/.bb/thread-storage/thr_9s7rehr925-adviser/voice-spike/`:

- **`before/`** has today's voice mode in the Bot chat: idle, hands-free
  listening, and the Bot speaking. They were taken from this build, so the
  header already shows the new waveform button.
- **`after/`** has Hands-free in these states:
  - idle and listening;
  - you talking;
  - the voice speaking, with subtitles;
  - a tool result ("2 need you");
  - a relay, sent at once ("✓ Sent to the Kensico lead" under the subtitles);
  - the only confirm card: a destructive action ("Drop the loop 'Remove the
    stale Tailscale node'? Say yes to drop.");
  - dropped, after the yes;
  - a reply;
  - every state again in dark mode (`-dark`).
- **`hands-free-scripted-session.mp4`** is the simulator recording of the mock
  session under the new rules. It runs "What's waiting", a snooze, an instant
  send to the Kensico lead, dropping a loop after a spoken yes, the lead's
  reply, and a barge-in. (`-small.mp4` is the earlier recording, under the
  read-back rule.)
- **`mock-voice-thread.md`, `mock-timings.json` and `mock-server.log`** come
  from that run.
- **`hands-free-live-session.mp4`** is the live run against `gpt-live-1`: 74 s,
  **with sound** (GPT-Live's voice and the synthetic user, put on the
  simulator video and lined up to the subtitles within about 0.2 s). It has
  what's waiting, the relay with the read-back and "yes, send it", the lead's
  reply, and a barge-in on a long answer. `live-audio.wav` is the sound alone.
- **`live-timings.json`, `live-voice-thread.md` and `live-server.log`** come
  from the live run. The voice thread got exactly two posts: the relay as it
  happened, and the transcript at hang-up.
- **`hands-free-live-bargein.mp4`** (with sound) and `live-bargein-*` are the
  re-run with the level-based barge-in: two cut-ins, muted 0.20 s and 0.18 s
  after the first word.
