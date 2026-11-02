# Hands-free voice takes on the thread's identity

A hands-free session ([spike.md](spike.md)) used to be a generic voice
assistant that relayed to the Chief of Staff. Now it speaks **as the thread it
was launched from**. It knows who it is, what was said there lately, and where
to send what it can't answer.

## Who it is

`voiceLive.start` takes the launching thread (`threadId`). The desktop
composer's waveform button passes its thread. iOS's Talk to Bot and the Bot
tab pass none, which means the Chief of Staff.

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
| Memory | The Bot's Memory page, without its "## Check-in" list, cut to its first ~1,500 characters | — |
| Recent context | The chat's last 6 messages (BB's thread timeline), each cut to ~280 characters | The same, from that thread |
| Open loops | Needs you now (up to 6) and Coming up (up to 4), titles only | — |
| Project | — | The thread's project name |

**Size cap:** about 1,500 tokens, counted as 6,000 characters. Each section
has its own budget (role 600, memory 1,500, loops 900, recent 2,200), and the
whole seed is cut at 6,000. It reaches OpenAI as data, not instructions.

**Speed:** the sources are Studio's own tables and one timeline read, fetched
together. Studio measures the build and records it with the session
(`identity` event: `ms`, `chars`, `missing`).

## Where relays go

- **Chief of Staff:** anything it can't answer itself goes to the CoS chat
  (`send_to_cos`, or `send_to_thread` with no target).
- **Any other thread:** to that thread. `send_to_thread` with no target means
  the launching thread, so "tell it…" with no name goes there. Other names
  still resolve as before ("the Kensico lead"), and `send_to_cos` still
  reaches the Chief of Staff.

The voice thread stays hidden under the Bot. It gets the transcript as
before, and relays still land in their target thread.

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
