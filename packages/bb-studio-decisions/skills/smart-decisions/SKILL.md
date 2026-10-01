---
name: smart-decisions
description: Set up or troubleshoot Studio Decisions, the one place BB Studio configures its fast Jev (System One) model and fallback model. Use it to check the Jev providers Smart Queue and Studio Teams use, explain why a message sent to a busy BB thread steered the running turn or waited as a follow-up, or dry-run that decision with the bb smart-decisions CLI.
---

# Studio Decisions

Studio Decisions holds the Jev provider keys, timeout, and fallback model for
BB Studio. Two things use them:

- **Smart Queue**, built in, classifies owner messages sent to a busy thread.
  It uses Jev first, then the fallback model, then follow-up. It never acts on
  messages sent by agents or other threads, so `bb thread tell` from inside a
  thread is not classified. It pauses while the standalone `smart-queue`
  plugin is enabled, so only one of them decides.
- **Studio Teams** routes channel messages through Studio Decisions' plugin
  RPC. Its `routingEngine` picks Jev or the fallback model; the keys and models
  are set here, not in Studio Teams.

## Commands

```sh
bb smart-decisions status [--json]
bb smart-decisions recent [--limit <n>] [--json]
bb smart-decisions classify <thread-id> <message> [--json]
bb smart-decisions check [--json]
bb smart-decisions fallback [thread | off | <provider-id> <model> [<reasoning-level>]] [--json]
```

- `status` shows whether Smart Queue is on or paused, the Jev providers it will try in
  order, configuration problems, and the fallback model.
- `recent` lists up to 30 decisions with the action, the classifier that
  decided and through which provider (`Jev 86% via TypeSafe`,
  `fallback model via pi/…`, or `no classifier answered`), the
  thread, and a message preview.
- `classify` runs the classifier against a thread's current context and prints
  the decision. It does not send or queue anything. With no Jev provider, it
  starts and deletes one hidden fallback-model thread.
- `check` sends a fixed sample message to Jev and reports which provider
  answered and how long it took. It never reads a thread.
- `fallback` shows or sets the model used when no Jev provider answers:
  `thread` (the busy thread's provider and default model), `off`, or a provider
  ID and model from `bb provider models`, with an optional reasoning level.

## Settings

Change settings with `bb plugin config smart-decisions set <key> <value>`.

- `jevProvider`: `auto` (default), `typesafe`, `vercel`, `openrouter`,
  `opencode-zen`, or `custom`. `auto` tries each configured provider in that
  order and moves on when one fails.
- Provider keys are secrets: `typesafeApiKey`, `vercelApiKey`,
  `openRouterApiKey`, `zenApiKey`, and `customJevApiKey`. Ask the owner for
  them; never print them. Environment fallbacks are `TYPESAFE_API_KEY`,
  `AI_GATEWAY_API_KEY`, `OPENROUTER_API_KEY`, and `OPENCODE_API_KEY`.
- `typesafeModel`: `jev-latest` (default), `jev-preview`, or `jev-1.13.0`.
- A custom provider needs `customJevEndpoint` (full HTTPS URL of a System One
  endpoint, or HTTP on localhost) and `customJevModel`. For short-lived tokens,
  set `customJevApiKeyCommand` to a command that prints the token instead of
  `customJevApiKey`. `customJevHeaders` adds `name: value` headers separated by
  semicolons.
- `jevTimeoutMs` applies to every caller. `steerConfidence`, `batchConfidence` and
  `enabled` apply to Smart Queue only; Studio Teams keeps its own confidence threshold.
- The fallback model is not a `bb plugin config` setting. Use
  `bb smart-decisions fallback`, or the picker on the settings page.

Run `bb smart-decisions status` after a change. It lists the Jev routes in order
and any configuration problems.

## Troubleshooting

- `no classifier answered`: no Jev provider answered, and the fallback model
  failed too. Read `bb plugin logs smart-decisions` for the reason.
- A queued card that says *Smart Queue: follow-up after the current turn* is
  released when the thread goes idle. The owner can use the card's **Send now**
  or **Steer** button to override it. Sending a card by hand cancels its
  pending decision, and editing a held card classifies the new text.
- *Smart Queue is grouping related follow-ups into one turn* shows for a few
  seconds after a thread goes idle with several follow-ups. The logs say how
  many were grouped (`Smart Queue grouped 1 of 2 follow-ups with …`). Raise
  `batchConfidence` to group less, or set it to 1 to turn grouping off.
- `request failed (HTTP 400)` from a Jev provider ends with the provider's own
  reason, such as an unsupported model name. Run `bb smart-decisions check` to
  retry with a fixed sample.
- Studio Teams says *Studio Decisions did not answer*: Studio Decisions is not
  installed or is disabled. *No Jev provider is configured*: add a key here.
- To stop Smart Queue, run
  `bb plugin config smart-decisions set enabled false`.
