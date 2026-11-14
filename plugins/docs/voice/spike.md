# Hands-free voice: spike

The spike behind the spec page "Voice mode: hands-free spec"
(`pg_demo000000000003`), built on the user's decisions: a separate voice agent
that relays visibly to the CoS and threads, GPT-Live first with Realtime as the
fallback, eyes-free rules enforced in Studio, Bluetooth mic routing, and an iOS
screen with a talking icon and subtitles. CarPlay is on hold. This is a spike:
it isn't merged or released.

**Status, Nov 1.** It ran live against the real `gpt-live-1`, with Studio's
real tool layer and the real iOS app in a simulator (see "Live run" below):
"what's waiting", a relay to the Larkspur lead (then still with a read-back and
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
| iOS core (Swift 6 clean, no app imports): wire events, session state machine, audio session config | [`ios/iOS/VoiceLive/Core/`](../../../ios/iOS/VoiceLive/Core/) |
| iOS app: WebRTC and mock transports, controller, screen, `-qaVoiceLive` demo states | [`ios/iOS/VoiceLive/`](../../../ios/iOS/VoiceLive/) |
| Talk dictation's Bluetooth fix (HFP) | [`TalkRecorder.swift`](../../../ios/iOS/Talk/TalkRecorder.swift) |
| Scripted GPT-Live mock with Studio's real tool layer | [`packages/bb-studio/scripts/voice-mock/server.ts`](../../packages/bb-studio/scripts/voice-mock/server.ts) |
| **Desktop:** the panel, session, transports, and the same machine and barge-in gate in TypeScript | [`packages/bb-studio/src/voice/live/ui/`](../../packages/bb-studio/src/voice/live/ui/) |
| Desktop staged capture (renders, recording, trace, CSP check) | [`scripts/capture/voice-desktop.mjs`](../../scripts/capture/voice-desktop.mjs) |

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

The user's rule (Nov 1, replacing "read back every send"): **act at once, say it
briefly; confirm only what's destructive or hard to undo.** Every tool call is
classified in [`rules.ts`](../../packages/bb-studio/src/voice/live/rules.ts)
(`classify`) and enforced in [`live.ts`](../../packages/bb-studio/src/voice/live/live.ts),
not just in the prompt. Tests are in `live.test.ts` and `rules.test.ts`.

| Class | Tools | How Studio enforces it |
| --- | --- | --- |
| **Read**, free | `loops_list`, `read_replies` | Read-only; tests check they write nothing. |
| **At once**, said briefly | Relays: `send_to_cos`, `send_to_thread`. Loop actions: done, snooze, hand off (`loops_act`), add (`loops_add`) | A relay is sent right away, visible in the target thread **from the voice thread** (`senderThreadId`), and posted in the voice thread. For `answer` intent the voice says “Asking the Larkspur lead now.” and waits, then reads the full reply in chunks (see [identity.md](identity.md)). For `do` or `fyi`, Studio answers "Sent to the Larkspur lead." and the voice says that; the phone shows "✓ Sent to the Larkspur lead" under the subtitles. Loop actions run at once with a **spoken 10 s undo** (`undo` restores status, trigger and owner; undoing an add removes the loop). |
| **Confirm**, destructive or hard to undo | Drop a loop (`loops_act` drop), `stop_thread`, `archive_thread`, `pause_automation`, `delete_automation` | Nothing happens yet. Studio returns one question ("Drop the loop 'Remove the stale Tailscale node'? Say yes to drop."), the voice asks it, and the phone shows **"Waiting for your yes"**, the only place that card appears. `confirm` acts only if Studio's own transcript has a **user line whose speech started after the question went back to the model** that is a short, clear yes ("Yes, drop it" counts). Transcripts come late, so the request itself can land after the question: the client marks each user line with when its speech started (`started_at`, from the mic, Realtime's speech start or its first words) and, if that was after the question came back, the action it answers (`answers`). Only marked lines count. A client that sends neither can't confirm by voice: nothing is done and the voice says to do it in BB. A yes said before the question doesn't count. A no or a change cancels. Whisper's filler ("Thank you for watching") and the voice's own question echoed into the mic aren't a yes. It expires after 45 s. The model saying "they said yes" counts for nothing. |
| **Never by voice** | Spending money, email or messages to people outside BB, posting publicly, approving credentials | No such tools exist, and an unknown tool name gets a refusal. A relay that *asks* for one is still sent, as a request. It's marked "⚠️ Voice can't approve this: ask me here first", and an agent-only note on every relay tells the target not to act on the voice's word for any of them. |

## The voice thread

Each session opens a BB thread in the personal project ("🎙 Voice · Nov 1, 5:35
PM"). Each post there is a `threads.send` with an agent-only "[PASS]" note,
because the SDK can't append a message without starting a turn, so posts are
kept to the minimum:

- **Every relay, as it happens:** one line, "→ Sent to the Larkspur lead: …".
- **The full transcript once, at hang-up:** a summary line, then both sides'
  words in order, interruptions, what was sent and what came back, the loop
  actions ("✓ Loop done: …") and anything done after a spoken yes ("⚠️ Done
  after a spoken yes: Dropped the loop '…'.").
- **A reply that arrives after hang-up:** the full speakable reply, plus a short phone push.
- **A hang-up that never arrives** (the app killed, the network gone): Studio's
  reaper ends any session with no word from its client for 10 minutes, the
  same way, when Studio starts and every minute after. A syncing client notes
  it's there once a minute (a `seen` event). If that client's own end comes
  later, its reports are saved once, so its usage still counts.

Nothing else is posted while the session runs: no transcript batches, and
replies during the session go into the end transcript (`live.test.ts`, "the
voice thread"). A session with one relay costs two record turns there. The
launching chat also gets one compact context message at hang-up when the user
spoke and the session relayed or the voice spoke. It links to the full voice
thread; replies in this context message are limited to 300 characters. See
[identity.md](identity.md#at-hang-up). The voice thread from the recorded mock session is saved as `mock-voice-thread.md`
in the deliverables folder.

## Barge-in and the subtitle UI

- **Barge-in, by level first.** While the voice plays, the phone watches the
  mic level ([`BargeInGate.swift`](../../../ios/iOS/VoiceLive/Core/BargeInGate.swift)).
  On the phone, the levels are WebRTC's `audioLevel` stats every 50 ms: the mic
  (`media-source`, after echo cancellation) and the voice (`inbound-rtp`).
  - **When it triggers.** The level must stay above a bar for 250 ms. The bar
    is 0.02 RMS when the voice is quiet. While the voice plays it is the higher
    of 0.06 and 70% of the voice's playback level plus 0.02, so the voice's own
    echo can't trigger it. (Until Nov 4 it was 120 ms, 0.035 and half: on the
    speaker, echo and room noise cleared that bar and cut the voice off again
    and again.)
  - **What happens.** The phone mutes the voice's track at once
    (`isEnabled = false`; in the mock it stops the player). Nothing is sent to
    the model yet.
  - **The transcript decides.** Words arriving confirm the barge-in. Then the
    phone sends the silent note with what the user heard ("The user interrupted
    you. They heard up to: '…'"; `session.thinking.append` for Live, a system
    item for Realtime), and the rest of the cut-off reply isn't shown or played.
    If no words come within 0.4 s of the user's level dropping back below the
    bar that fired, it was a false alarm (a cough, a bump): the voice is
    unmuted and carries on, and the phone reports a `false_trigger` event
    (levels and how long it was muted) to Studio. Words that come later still
    barge in on their own. While muted it skips that stretch, because WebRTC
    can't pause a live stream.
  - **Why the window starts when the level drops.** GPT-Live's transcript of
    the user lags about 2.4 s while the voice talks. A window counted from the
    trigger cancelled a real barge-in in testing.
- **The audio session and WebRTC.** WebRTC runs in manual-audio mode inside
  Studio's session ([`VoiceLiveAudio.swift`](../../../ios/iOS/VoiceLive/VoiceLiveAudio.swift)).
  Each time the app activates the session (start, a route change, an
  interruption's end, a media-services reset) it calls
  `audioSessionDidActivate` and turns WebRTC's audio on; at an interruption
  and at hang-up it turns it off and calls `audioSessionDidDeactivate` before
  deactivating, retrying while the voice-processing unit winds down. WebRTC's
  own session config is set to ours, so it keeps `.defaultToSpeaker`. The
  voice plays on the loudspeaker unless AirPods, Bluetooth, a wired headset or
  the car is connected. Route changes, interruptions, the app going to the
  background and why the session closed go to Studio as events in
  `voice_call_events`.
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

**The relay, live** (under the earlier read-back rule; relays are now instant). The user said "Tell the Larkspur lead to pause the eBay
fetcher until Monday". The backend called `send_to_thread`; Studio drafted it
and returned the read-back, and the voice said it word for word: "Send to the
Larkspur lead: Please pause the eBay fetcher until Monday. Say yes to send." The
user said "Yes, send it". The backend called `confirm_send`, and Studio found
the yes in its own transcript after the draft and sent it, from the voice
thread. The fake lead answered 2.5 s later, and the voice said: "The Larkspur
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

The monthly cap defaults to $20 (setting: "Monthly limit (USD)" in Studio's Voice settings),
which is about 400 minutes of GPT-Live. Studio refuses to start a session at the
cap. `voiceLive.event` returns `stop` once a running session crosses it, and the
phone says why and hangs up. The voice thread's "[PASS]" turns aren't counted:
they run on that thread's own model.

Usage only counts once Studio has it, so the clients don't lose it: a sync,
tool call or hang-up that fails puts its reports back in the queue, in order,
and the next one sends them, at most 200 a call (the contract's limit). After
10 failed syncs in a row (30 s without Studio) the client hangs up and says
why. The final usage that answers `session.close` is sent with the end, and the
end is retried for about two minutes.

## What the old voice mode still provides

The old in-thread voice mode (speech to text, then the thread, then text to
speech) was removed on Nov 1 ([removal-list.md](removal-list.md)); dictation
stays. **The new agent doesn't
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
  "[PASS]" turn there. The launching thread also gets one compact context turn
  at hang-up. An SDK "append without a turn" would remove them, but
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

## Desktop

The user tests it first at the Mac, in the BB window, before any TestFlight.
It uses the same voice agent, Studio relay, tool layer, eyes-free rules, cost
cap and voice-thread posting as the iPhone.

- **v2 (Nov 1): a floating pill, started from the composer.** A session is
  its own thread, so it isn't docked anywhere.
  - **Start:** a waveform button in the composer's bottom row, via
    `app.composer.customize` actions, the slot voice mode's speaker uses today.
    "Studio: Hands-free voice" in the command palette does the same. The first
    version's big panel and header button are gone.
  - **The pill:** a Studio app overlay (`experimental_appOverlay`) that floats
    over every page and thread until End. Like Talk's dictation pill, it's
    draggable and remembers its own spot (`useDraggable` takes a storage key).
    It shows the small talking orb (teal for you, the accent for the voice,
    purple while thinking), the current subtitle line, "✓ Sent to …" inline,
    and End.
  - **Expanded:** it opens by itself for a destructive action's "Waiting for
    your yes" and closes again once that's answered. On demand (the chevron)
    it shows the transcript, the model, cost and mic, the last tool result, and
    "Open the voice thread".
  - **The voice thread lives under the Bot.** When it opens, Studio claims it
    for the Bot (`BotOwnedThreads.claim`, the mechanism the Bot's other threads
    use, but quiet: no line in its chat). It's hidden from BB's main Threads
    list, and listed under the Bot in Recent (Running while live), so Recent
    under Chief of Staff rather than a separate group.
  - **Search:** BB's thread search skips hidden threads, the Bot's own chat
    included, so Studio's "Search everything" finds voice threads in their
    transcripts, sends and replies instead (`VoiceLive.search`).
  - Tested: `bot-owned.test.ts` and `live.test.ts`; renders in `voice-desktop-v2/`.
- **Placement: Expand, waveform, mic, send.** BB renders every plugin's
  composer actions just before its own mic, grouped by plugin and in
  registration order within a plugin. The action has only `id` and
  `component`: no order or priority, on SDK 0.6.37 or 0.6.104. So Studio
  registers the waveform after Notes' Expand, which puts it right next to the
  mic. BB orders plugin groups by how often each is clicked, so another
  plugin's composer action can end up between Studio's group and the mic.
  Studio can't change that.
- **Quick settings: right-click the waveform.** A composer action has no menu
  of its own on either SDK, so it's a context menu (Studio's kit, Radix) on
  Studio's own button (`ui/QuickSettings.tsx`). It shows the model (gpt-live-1
  or gpt-realtime-2.1), the voice from that model's own list, the backend model
  (gpt-live-1 only), this month's spend against the cap (read only), and
  "Voice settings…". Each choice is saved through `voiceLive.configure` as a
  Studio setting. Sessions read settings when they start, so a change applies
  to the next session, and the menu says so: OpenAI fixes a session's voice
  and models when it's created. "Voice settings…" opens Studio's settings page
  and scrolls to its **Voice** section, whose Hands-free rows hold these
  settings and the month's spend.
- **Settings** (Studio settings in the Voice section, also `bb studio settings`):
  | Key | Label | Default |
  | --- | --- | --- |
  | `voiceLiveModel` | Hands-free model | gpt-live-1 |
  | `voiceLiveVoice` | Hands-free voice | marin |
  | `voiceLiveBackendModel` | Backend model | gpt-5.6-luna |
  | `voiceLiveMonthlyCapUsd` | Monthly limit (USD) | 20 |

  The cap and model keep their first keys, so saved values carry over. The
  Voice section lists only the chosen model's voices. A
  voice the chosen model doesn't have falls back to marin, and the menu only
  offers the model's own voices. GPT-Live's voices are marin, quartz, ripple,
  vesper, willow, stone, gleam, meridian, bossa, tempo, beacon, delta, cinder,
  nuri, juni, flitz, brise, sillage, nira, harema, shida and noeul. Realtime's
  are marin, cedar, alloy, ash, ballad, coral, echo, sage, shimmer and verse
  (OpenAI's docs, checked Nov 1). The backend can be gpt-5.6-luna, -terra or
  -sol, and a session's backend tokens are priced by the one it used.
- **Transport: browser WebRTC in the BB window.** It uses
  `RTCPeerConnection` and `getUserMedia` with `echoCancellation: true`. Studio
  exchanges gpt-live-1's SDP, and Realtime posts its offer with a client
  secret. The staged mock is a WebSocket with Web Audio playback.
- **Barge-in by level:** Web Audio `AnalyserNode`s on the mic (after echo
  cancellation) and on the voice's stream feed the same gate and machine as
  iOS, ported to TypeScript with the same tests
  (`machine.test.ts`, `session.test.ts`).
- **Anything in BB blocking it?** Nothing found in the BB web UI.
  - It sends no `Content-Security-Policy` header or meta tag, and no
    `Permissions-Policy`.
  - In both staged runs, the page's console errors, unhandled rejections and
    `securitypolicyviolation` events were recorded. There were none from the
    mic, WebRTC or the socket; the only messages were an unrelated
    `experimental_ThreadActionsMenu` className warning.
  - Not checked: the Electron desktop shell's own permission handler and any
    CSP it adds, because staged tests run in Chrome against the web UI. Studio's
    Talk recorder already uses `getUserMedia` there, but WebRTC to OpenAI hasn't
    been tried in the shell.

### Staged runs

Both runs were in a staged BB from `scripts/staged-bb.mjs` (stable 0.48.1),
with Studio installed from this branch (`git:<worktree>@<commit>`). The Bot was
created there with `bot_create`, and three loops were seeded in its database.
The capture Chrome drove the real header button and panel
(`scripts/capture/voice-desktop.mjs`).

- **Mock.** The staged BB ran with `STUDIO_VOICE_MOCK_URL`, and the voice mock
  ran with `--script desktop`. The panel called the staged Studio's real
  `voiceLive.tool`. The relay landed in the seeded thread "Review the launch
  checklist", and dropping "Remove the stale Tailscale node" needed the spoken
  yes. Tool round trips were 3–20 ms. No real mic was used: the script plays
  the user's side, including the mic levels.
- **Live, gpt-live-1.** The staged BB had `OPENAI_API_KEY` from the staged
  dotenv. Chrome's fake mic played a synthetic voice file
  (`--use-file-for-fake-audio-capture`, macOS `say`, six lines at fixed
  times), and the panel talked WebRTC to GPT-Live. Times are measured from when
  the mic opened, against the file's word onsets:

| What | Live, desktop (3rd run, after the fixes) |
| --- | --- |
| Mic open → `session.started` | 1.4 s (SDP through Studio, then WebRTC) |
| **Barge-in: first word → voice muted** | **0.23–0.50 s** (four cut-ins: 0.50, 0.23, 0.47, 0.39). The transcript confirmed each about 1.2 s after the first word. |
| User's first word → first transcript word | 1.1–1.4 s |
| End of speech → the voice's first words (transcript), **turn latency** | 0.76–2.28 s, tool calls included |
| Tool calls through Studio's real tool layer | 5 per run (loops_list ×2, send_to_thread, loops_act drop, confirm) |
| Session cost | ≈ $0.06 for about 1 min |

**Found in the staged live runs, and fixed:**
- **The voice thread never opened.** It was spawned with a host environment
  and no host id: "hostId is required unless workspace.type is personal". It
  now uses the personal project's default environment, like the Bot's chat. The
  third run's voice thread is saved as `live/live-voice-thread.md`.
- **One barge-in muted and unmuted three times.** GPT-Live's transcript of the
  user comes in bursts while the voice talks, so the 0.9 s pause ended the
  user's line too early, and the voice's next words unmuted it. A line now ends
  only when the mic is quiet too (desktop and iOS).
- **The voice offered "undo" after a confirmed drop.** Studio's result now says
  it can't be undone by voice.

**Noticed and not changed.** Because a relay sets `senderThreadId`, BB delivers
the target thread's reply into the voice thread as a message. That's one more
short `[PASS]` turn there per relay; the agent did pass each time. Dropping
`senderThreadId` would save the turn but lose "from the voice thread" in the
target.

## How to run it

- Studio: `cd packages/bb-studio && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vitest run src/voice/live`
- iOS core in Swift 6: `ios/scripts/check-voice-live-swift6.sh`
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
- Desktop, staged:
  1. Run `node scripts/staged-bb.mjs start` with `STUDIO_VOICE_MOCK_URL` (mock)
     or `OPENAI_API_KEY` from the staged dotenv (live) in the environment.
  2. Install Studio from the branch: `bb plugin install git:<worktree>@<commit> --plugin studio`.
  3. Run `bot_create`, and seed loops.
  4. `VOICE_DESKTOP_OUT=<dir> node scripts/capture/voice-desktop.mjs mock|live`.
     For live, add `BB_CAPTURE_CHROME_ARGS="--use-file-for-fake-audio-capture=<wav>"`
     and `VOICE_DESKTOP_END_AFTER=85`.

## Deliverables

Desktop v2 (the floating pill), in `~/.bb/thread-storage/thr_demo000006-adviser/voice-desktop-v2/`:
the composer button; the pill appearing, listening, speaking and sent; the
expanded yes question and transcript; the pill over a Studio page and over
another thread; the ended pill's transcript; the voice thread opened from its
link; voice threads under the Bot in the sidebar; and
`handsfree-desktop-pill.mp4`. Each render is in light and dark (`-dark`).

Desktop v1 (the panel), in `~/.bb/thread-storage/thr_demo000006-adviser/voice-desktop/`:

- **The header button:** `header-button.png` and `-dark`, with its tooltip.
- **Renders from the mock run,** each in light and dark (`-dark`): idle (the
  panel before Start), listening, speaking with subtitles, the confirm card (a
  destructive drop), sent, and ended.
- **`handsfree-desktop-mock.mp4`:** the 44 s mock session.
- **`trace-mock.json`, `problems-mock.json` and `mock-server.log`.**
- **`live/`:** the third live gpt-live-1 run, with the same renders,
  `handsfree-desktop-live.mp4` (87 s, no sound: the capture Chrome runs with
  `--mute-audio`), `trace-live.json`, `problems-live.json`,
  `live-voice-thread.md`, and the synthetic voice (`user-voice.wav` and
  `user-voice-onsets.json`).

iPhone, in `~/.bb/thread-storage/thr_demo000006-adviser/voice-spike/`:

- **`before/`** has today's voice mode in the Bot chat: idle, hands-free
  listening, and the Bot speaking. They were taken from this build, so the
  header already shows the new waveform button.
- **`after/`** has Hands-free in these states:
  - idle and listening;
  - you talking;
  - the voice speaking, with subtitles;
  - a tool result ("2 need you");
  - a relay, sent at once ("✓ Sent to the Larkspur lead" under the subtitles);
  - the only confirm card: a destructive action ("Drop the loop 'Remove the
    stale Tailscale node'? Say yes to drop.");
  - dropped, after the yes;
  - a reply;
  - every state again in dark mode (`-dark`).
- **`hands-free-scripted-session.mp4`** is the simulator recording of the mock
  session under the new rules. It runs "What's waiting", a snooze, an instant
  send to the Larkspur lead, dropping a loop after a spoken yes, the lead's
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
