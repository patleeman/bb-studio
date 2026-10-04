---
name: talk
description: Use when the user refers to a Talk recording or dictation — a mention like "Talk recording …", a /plugins/talk/recordings/<id> link, a recorded summary, or "what did I say in …" — or asks how Talk's recording, dictation, or settings work.
---

# Talk

Talk is BB's long-form, durable dictation and recording plugin. The browser
captures audio in short pieces (about 25 seconds, cut at a pause), saves each
piece on the device, uploads it, and the BB server transcribes it through the
voice service in **Settings → AI services** (the user's ChatGPT subscription
through Codex by default). Every recording is saved, titled, and searchable.

## Reading recordings

A mentioned recording arrives as context with its title, link, status, and
transcript (up to 60,000 characters). Use `talk_list`, `talk_search`, and
`talk_read` to find recordings and read summaries or bounded transcript
pages. The CLI is also available.

```sh
bb talk list [--query <text>] [--json]     # 50 most recent, or matches in titles and transcripts
bb talk show <recording-id> [--json]       # status, length, words, segment counts, link
bb talk transcript <recording-id> [--cleaned] [--offset <chars>] [--limit <chars>]
```

`transcript` prints 20,000 characters by default (at most 60,000) and ends
with the command for the next page. It prints the original transcript;
`--cleaned` reads the complete saved cleaned version instead. Paragraph breaks mark where the speaker
paused, resumed, or reloaded the page.

Link to a recording as `[Title](/plugins/talk/recordings/<recording-id>)`.

A transcript can be incomplete: `show` reports segments still transcribing
or failed. Say so instead of guessing at the missing part.

## How it behaves

- **Composer microphone.** With *Replace built-in dictation* on, the
  composer's mic starts a Talk dictation. Pressing it again (or ✓ in the
  pill) stops, waits for the transcript, and types it into that composer.
  ✕ stops without inserting. The dictation stays in Recordings either way,
  unless it had no words.
  While Talk is capturing, the mics in other threads are dimmed and say where
  the dictation is. If the user finishes while away from its thread, the
  text waits and is typed into that thread's composer when they go back. The
  thread's sidebar row shows a mic while it is dictating or has text waiting.
- **Dictation fields.** Other plugins can mark an editor as a dictation
  field (Pages does this for each page). A dictation there works like one in a
  composer. The transcript goes in at the cursor, text finished elsewhere
  waits for the field (for up to three days), and **Go back** opens the
  field. If the plugin that owns the field is gone, **Go back** copies the
  text instead, and it's always kept in Talk recordings. *Talk: Start or
  finish dictation* works in a focused field. `README.md` documents the DOM
  contract for plugin authors.
- **Recordings.** *New recording* on the Recordings page, or the command
  "Talk: Start or stop a recording", records without inserting anywhere.
  Use it like a note for brain dumps, ideas, meetings, or hours-long sessions.
  **Clean up transcript** saves a separate cleaned version, with **Original**
  and **Cleaned** views. The original text and audio stay intact. Copy and
  text downloads use the selected version. **Send to agent** opens a thread
  attached to the recording. Mentions and `talk_read` prefer a complete saved
  cleaned version; use `talk_read` with `version: "original"` for raw text.
  A **Summary** is optional: a concise paragraph of the recording's main ideas,
  without a meeting template or automatic task assignments. Generate it from
  the recording menu or enable **Automatically summarize recordings** (off by
  default).
- **Playback.** The recording page has a scrubber, play/pause, volume, speed,
  and 10-second skips. Clicking transcript text or its timestamp starts audio
  at that section. The current section is highlighted; **Follow transcript**
  keeps it visible. Timing is per audio section, not per word.
- **Recordings page.** A table the user can search, filter by kind, and sort.
  Selected rows can start one thread that mentions them all, have their
  transcripts copied as one Markdown document, have failed pieces retried,
  or be deleted together. The recording Talk is capturing can't be selected,
  and the server refuses to delete a recording while a window is capturing it.
- **Recording pill.** A small pill at the top of every page shows the clock,
  input level, and pause/stop controls. Expand it to read the live transcript.
  It follows the user between threads, and it can be dragged anywhere in the
  window; it remembers where. Away from where the capture started, a back
  arrow returns to that thread or recording.
- **Durability.** Audio is saved on the device every few seconds and on the
  server before it is transcribed. A page reload resumes the same recording,
  and offline audio uploads when the connection returns. A capture that
  vanished (a closed laptop, a killed app) shows as *Interrupted*, and
  *Resume recording* on its page continues it. Audio the server refuses as
  invalid stays on that device, listed at `/plugins/talk/recordings/unsent`,
  where the user can retry, download or discard it. Agents can't reach it.
- **Mobile.** Recording runs while the BB app is in the foreground. If the
  app goes to the background, the microphone stops; Talk resumes when it
  returns, or shows *Resume* if the system needs a tap first.
- **Failures.** Pieces that fail to transcribe retry with backoff for about
  nine hours, or every 10 minutes while the voice service is off or signed out.
  *Retry* on the recording's page requeues pieces that gave up. Audio is
  never discarded on failure.
- **Empty recordings.** A dictation or recording that finishes with no
  transcribed words (and no failed pieces) is deleted with its audio. A
  recording id that no longer resolves may have been one of these.

## Settings

| Setting | Default | Effect |
| --- | --- | --- |
| Replace built-in dictation | on | The composer mic starts Talk. Off restores BB's one-shot dictation. |
| Segment length (seconds) | 25 | Target piece length, 8–60. Shorter shows text sooner. |
| Automatically summarize recordings | off | Summarizes on completion; the recording menu can summarize on demand. |
| Auto-title recordings | on | Titles a recording from its transcript through a hidden, short-lived agent thread. |
| Cleanup model | Studio Decisions | Provider and model picker for dictation and saved-transcript cleanup. |
| Titles model | Studio Decisions | Provider and model picker for automatic titles. |
| Summaries model | Studio Decisions | Provider and model picker for automatic and on-demand summaries. |

The **Models** section also saves reasoning and the provider's supported service
tier. Choices apply to future requests across devices. Studio Decisions must be
enabled; following it uses its fallback model. Voice transcription remains in
**Settings → AI services**. Segment length accepts 8 to 60 seconds; dictation
audio retention accepts 0 to 3650 days, with 0 keeping audio forever.

A title the user edited is never replaced.
