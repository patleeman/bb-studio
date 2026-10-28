# bb-talk-tap

The native helper behind Talk's call transcription. Studio's server starts
it as a child process to capture a call on macOS 14.2+:

- **Them:** the call's audio, through a Core Audio process tap on the chosen
  apps (and their helper processes), or on all system audio.
- **Me:** the mic, through Apple's voice processing (echo cancellation).

It cuts each source into 16 kHz mono WAV segments at pauses. It can also
transcribe them locally with WhisperKit.

The built binary is committed at [`../../bin/bb-talk-tap`](../../bin), with
its SHA-256 in `bb-talk-tap.sha256`. Studio refuses to run a binary whose hash
doesn't match.

## Protocol

`bb-talk-tap <command> [--json-args '<json>']`. Output is JSON lines on
stdout, one object per line. stderr is for logs only.

| Command | Output |
|---|---|
| `apps` | `{"apps":[{"bundleId","name","pid","playing"}]}`: apps with audio, playing ones first. Needs no permission and creates no tap. |
| `permission` | `{"audioCapture":"granted"\|"denied"\|"undetermined"}`, read without prompting. |
| `capture --json-args '{…}'` | Events until stdin gets `{"cmd":"stop"}` or closes. |
| `--version` | `bb-talk-tap 1.0.0` |

Capture arguments:

```json
{
  "target": {"bundleIds": ["us.zoom.xos"]},
  "mic": true,
  "segmentDir": "/abs/path",
  "segmentTargetMs": 8000,
  "segmentMaxMs": 15000,
  "stt": {"kind": "whisperkit", "model": "openai_whisper-large-v3-v20240930_626MB", "modelDir": "/abs/path"}
}
```

`target` can also be `{"all": true}`. `stt` can be `{"kind": "none"}`, or
`{"kind": "test"}` in tests: a stand-in that returns `"<n> ms of audio"`.

Events:

| Event | When |
|---|---|
| `{"event":"started","sources":["them","me"]}` | First, before anything else. Lists the sources that actually started. |
| `{"event":"level","source","rms"}` | Every 100 ms of audio per source (at most 10 a second). |
| `{"event":"segment","source","index","path","startMs","endMs"}` | A segment file is closed. Studio owns it from then on. |
| `{"event":"partial","source","index","text"}` | Text so far for the open segment `index` (WhisperKit only). |
| `{"event":"final","source","index","text","startMs","endMs"}` | The transcript of segment `index`, always after its `segment` event. |
| `{"event":"model","progress","stage"}` | Model download progress (`stage` `download`), then `progress` 1 with `stage` `ready`. |
| `{"event":"appGone","bundleId"}` | A tapped app quit. Capture continues; Studio decides whether to stop. |
| `{"event":"error","code","message"}` | `permission`, `device`, `model` or `internal`. |
| `{"event":"stopped"}` | Last line, then the helper exits. |

Details:

- **Time:** `startMs` and `endMs` count from the start of capture, on each
  source's audio clock. Both sources share the same zero, so Studio merges
  them by `startMs`.
- **Segment files:** `<segmentDir>/<source>-<index>.wav`, for example
  `them-00003.wav`. Each is written to a temporary name, then renamed, so a
  path in an event is always a complete file. `index` counts 0, 1, 2… per
  source.
- **Segmenting:** silence makes no segments. Each segment keeps about 300 ms
  before the first speech. It closes at the first pause (300 ms) after
  `segmentTargetMs`, or at the quietest moment before `segmentMaxMs`. A pause
  of 1.5 s closes it early, so a short reply is transcribed straight away.
  Segments with under 160 ms of speech (a click, a cough) are dropped.
- **Stop:** the open segment is closed and finals still due are waited for
  (up to 2 minutes). Then `stopped` is sent.
- **Errors:** a failed tap is an `error`, then `stopped` (exit 1). A failed
  mic is an `error`, and capture continues with "them" only. If the model
  can't load, an `error` with code `model` is sent and no finals follow.
  Studio can transcribe the segment files itself.

## Live capture

This path is built and unit-tested, but it has never run on the development
Mac. The first real tap shows a macOS prompt, so Patrick runs it when he
first uses the feature.

- **Them (process tap):**
  - `CATapDescription` is a stereo mixdown of the target's processes: the app
    itself, helpers whose bundle ID starts with the app's
    (`com.google.Chrome.helper`), and processes the app is responsible for
    (Safari's WebKit processes).
  - `{"all": true}` is a global tap, excluding the helper itself.
  - The tap is private and passes audio through (`.unmuted`), so the call
    plays as normal.
  - It feeds a private aggregate device clocked by the default output
    device. The device is rebuilt if the output device changes, for example
    when headphones are plugged in.
  - If the app has no audio process yet, the tap is created once it opens
    one. Helper processes that appear later are added to the tap.
  - The audio is mixed to mono and resampled to 16 kHz with
    `AVAudioConverter`.
  - `appGone` is sent once for each target app that quits. Checks run every
    second.
- **Me (mic):**
  - Captured through `AVAudioEngine` with voice processing turned on for the
    input node. This adds echo cancellation and noise suppression.
  - Ducking of other audio is set to the minimum, so the call isn't turned
    down.
  - Channel 0 (the processed voice) is used.
- **Permissions:**
  - BB is the responsible app, so macOS asks on BB's behalf (see the spike in
    `docs/talk/call-capture-spike.md` on main).
  - Before tapping, the helper reads the "System Audio Recording Only" status
    without prompting. If it's denied, it sends `error` code `permission`.
    If it hasn't been asked yet, creating the tap shows the prompt.
  - The mic works the same way, using `AVCaptureDevice`'s status.
- **Timing:** the first buffer of each source carries its host time. That
  places it on the capture clock. From then on, time is counted in samples.

## Fake mode (tests)

```sh
bb-talk-tap capture --json-args '{…}' --fake them.wav me.wav [--fake-speed 10]
```

This plays two audio files (any format AVAudioFile reads) as the two sources,
in real time or `--fake-speed` times faster. It creates no tap, opens no mic
and shows no permission prompt. When the files end, the helper stops by
itself, as if it had been sent `stop`. Every test on a developer Mac uses this
mode.

## Build

```sh
./build.sh
```

This builds arm64 and x86_64 release slices, joins them with `lipo`, strips
the result and signs it ad hoc (identifier `dev.bbstudio.talk-tap`). It
writes `../../bin/bb-talk-tap` and `bb-talk-tap.sha256`. The Info.plist is
embedded in the binary's `__TEXT,__info_plist` section.

The build is reproducible: the same source and Xcode give the same bytes,
wherever the checkout is. Dependencies are pinned in `Package.resolved`, and
there is no debug info. Swift still bakes source path lengths into release
code, so `build.sh` always builds from a copy in `/tmp/bb-talk-tap-build`.

Commit the binary and its hash with the source change that produced them.

## Tests

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
swift test
```

- Unit tests cover the segmenter, level meter, WAV writing, resampling, the
  JSON protocol and the transcription queue.
- Integration tests run the built helper in fake mode, as Studio's server
  does, and check the events and the segment files.
