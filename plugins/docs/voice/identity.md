# Hands-free voice takes on the thread's identity

A hands-free session ([spike.md](spike.md)) used to be a generic voice
assistant that relayed to the Chief of Staff. Now it speaks **as the thread it
was launched from**. It knows who it is, what was said there lately, and where
to send what it can't answer.

## Who it is

`voiceLive.start` takes the launching thread (`threadId`) and returns the
session's `identity` (`kind`, `label`, `name`, `threadId`). The desktop pill
and the iOS hands-free header both show `label`. The desktop
composer's waveform button passes its thread. iOS's Bot tab waveform passes
that Bot's chat thread, and the `bbstudio://handsfree/<thread>` link its
thread. Talk to Bot (Action button, Siri) passes none, which means the Chief
of Staff. iOS has no thread-view launch.

| Launched from | It speaks as | The pill shows |
| --- | --- | --- |
| The Chief of Staff's chat (the primary Bot), or no thread | The Chief of Staff, by its name | "Chief of Staff" |
| Another Bot's chat | That Bot | The Bot's name |
| A project lead, a runner, or any other thread | That thread | The thread's title |

## The seed

Studio builds a short seed **once, at session start**
(`src/voice/live/identity.ts`). The session keeps it, and it goes into the
voice's and the backend's instructions. It's never rebuilt per turn, and
building it makes no LLM call.

| Source | Chief of Staff | Any other thread |
| --- | --- | --- |
| Name and role | The Bot's name and role (Studio's Bot record) | The thread's title, and its role from Studio's records: a Bot's role, "Lead of the X project", or a runner's job |
| Memory | The Bot's Memory page, without its "## Check-in" list, cut to its first ~1,100 characters | — |
| Latest reply | The latest assistant reply in this chat, made speakable, up to ~1,500 characters | The same, from that thread |
| Recent context | The chat's last 6 messages (BB's thread timeline), each cut to ~280 characters | The same, from that thread |
| Open loops | Needs you now (up to 6) and Coming up (up to 4), titles only | — |
| Project | — | The thread's project name |

**Size cap:** about 1,500 tokens, counted as 6,000 characters. Each section
has its own budget (role 400, memory 1,100, loops 800, recent 1,700, latest reply
1,500). The latest reply appears in its own “Your latest reply in this chat” section. It comes
from the same timeline read, before the recent-message window is applied. The
whole seed is cut at 6,000. It reaches OpenAI as data, not instructions.

**Speed:** the sources are Studio's own tables and one timeline read, fetched
together. Studio measures the build and records it with the session
(`identity` event: `ms`, `chars`, `missing`). Measured on a staged BB on
Nov 1, five starts each, the whole `voiceLive.start` call over the mock
transport took 4–26 ms. The seed build within it took:

- **Chief of Staff:** 2–6 ms, with one 21 ms cold start, for memory, loops
  and recent turns (452 characters).
- **Another thread:** 2–7 ms.

That's well inside the start latency (GPT-Live's connect is about a second),
so there's room for an LLM summary, but it isn't needed: the seed is
extractive.

## Where relays go

- **Chief of Staff:** anything it can't answer itself goes to the CoS chat
  (`send_to_cos`, or `send_to_thread` with no target).
- **Any other thread:** to that thread. `send_to_thread` with no target means
  the launching thread, so "tell it…" with no name goes there. Other names
  still resolve as before ("the Larkspur lead"), and `send_to_cos` still
  reaches the Chief of Staff.

The voice thread stays hidden under the Bot. Relays land in their target
thread immediately, from the voice thread.

Both relay tools require an `intent`:

- `answer`: questions and requests such as “run through”, “walk me through”,
  “what's the status”, or “tell me about”. The message preserves the request:
  “The user asks you to run through the changes you're working on.” The target
  is told to answer fully in plain speakable sentences, leading with the answer.
- `do`: a task to carry out.
- `fyi`: information to pass on.

Missing or invalid intent defaults to `answer`. This does not change the
confirmation rules or the warning about actions voice cannot approve.

For `answer`, the voice says “Asking <name> now.” and waits without guessing.
Studio delivers the full reply through the server's poll `note`, made
speakable, in chunks of at most `ANSWER_CHUNK_CHARS` (1,800 characters,
roughly two minutes). Chunks end at a sentence boundary; an oversized single
sentence falls back to a word boundary. The note tells the voice to read the
reply in full, in its own spoken words, without shortening. If cut, it marks
`Reply cut: true`, tells the voice to ask if the user wants the rest, and gives
the next `read_replies` `part` (starting at 1). With no target, `read_replies`
reads the latest session reply; with a target, it reads that thread's session
reply, or its latest reply if none was relayed. `do` and `fyi` keep the
600-character summary and one-to-two-sentence read-back.

Both iOS and desktop pass the poll `note` unchanged to the model.

### “Still waiting on X.”

For an `answer` relay, `voiceLive.tool` returns a `waitFor` next to its
`output`: `{ title, ms, note }`. `ms` is `STILL_WAITING_MS` (20 s) and `note`
is Studio's wording (`waitingNote(title)` in `src/voice/live/shared.ts`). The
voice is told to say only, briefly, “Still waiting on X.” `do` and `fyi`
relays, and every other tool, return no `waitFor`.

Each client starts one timer per relay (desktop: `SessionMachine.waitForReply`
in `ui/machine.ts`; iOS: `LiveSessionMachine.waitForReply`). When it's due and
neither the voice nor the user is talking, the client adds the note once, as a
spoken note. These cancel it:

- a reply for the session arrives (the poll),
- the user finishes a new line (a new request),
- the session ends, fails or is closed.

A newer `answer` relay replaces the pending one, so the voice still says it at
most once per relay.

## At hang-up

The voice thread keeps the full transcript, including full replies rather
than summaries. Replies arriving later also land there in full.

If the user spoke and the session relayed or the voice spoke, Studio posts
one compact message to the launching identity thread, from the voice thread
(`senderThreadId`). It starts “🎙 Voice session · N min”, includes You / Voice /
→ sent / ← answered lines, and links to the full voice thread with a thread
mention. Replies are summarized to 300 characters in this message; the whole
message stays under about 4,000 characters. Empty sessions and sessions without
user words do not post there. Repeated or concurrent hang-ups do not post twice.

The agent-only note says this is context from a voice conversation the thread
was part of. It must act only on requests that weren't already relayed and
answered; otherwise it replies exactly `[PASS]`. The full voice transcript is
still posted only in the voice thread.

## When a source is missing

The seed says what's missing, and the voice is told not to guess. It says
it doesn't know, and offers to ask the thread it speaks for.

- **No Memory page, or an empty one:** no memory section; `missing` lists
  `memory`.
- **Loops off or unreadable:** no loops section; `missing` lists `loops`.
- **The timeline can't be read:** no recent section; `missing` lists `recent`.
- **No role on record:** the name alone.
- **The launching thread can't be found:** the session falls back to the
  Chief of Staff, as if launched with no thread.
