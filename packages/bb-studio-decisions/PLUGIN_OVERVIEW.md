Set up BB Studio's fast decision models once. Studio Decisions holds the Jev
keys and the fallback model. Smart Queue and Studio Teams both use them.

Send a message to a busy thread without choosing between steer and queue, and
let Studio Teams pick which bots answer a channel message.

## What you get

- Corrections, cancellations, and urgent changes steer the running turn now.
- New or later tasks wait as follow-ups until the turn ends.
- When several messages steer, they reach the agent in the order you sent them.
- Studio Teams routes channel messages with the same Jev setup, so its keys
  live here too.
- If the standalone Smart Queue plugin is on, this one's queue pauses, so each
  message is decided once.
- `bb smart-decisions recent` lists each decision and the provider that made it,
  and `bb smart-decisions classify` dry-runs one.

## Choose how to reach Jev

Studio Decisions asks [TypeSafe](https://typesafe.ai)'s Jev model to decide. Add a
TypeSafe key, or reach the same model through Vercel AI Gateway, OpenRouter, or
OpenCode Zen. `auto` tries each configured provider in order and moves on when
one fails. To bring your own provider, point Studio Decisions at any HTTPS endpoint
that accepts TypeSafe's System One API.

Without a Jev key, a model from a BB provider you already use decides in a
hidden, temporary thread. If nothing answers, the message waits as a follow-up.

## What leaves your machine

Each Smart Queue decision sends the thread title, your last three requests, the end of the
latest assistant output, and the new message to the Jev provider you configured,
or to the fallback model's provider. Studio Teams sends the channel message,
recent channel messages, and the bot roster. That provider bills the usage.

Smart Queue acts only on messages you type. It leaves agent messages, plugin
messages, retries, scheduled sends, and Studio Teams threads alone.
