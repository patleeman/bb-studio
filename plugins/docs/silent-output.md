# Silent output: `[PASS]`

Providers won't end a turn with an empty assistant message, so an agent with
nothing to say needs a reply that means "nothing". In BB Studio that reply is
exactly:

```
[PASS]
```

## The rule for agents and prompts

Put this line in any prompt that runs on a schedule or reacts to events
(check-ins, heartbeats, runners, automations):

> If nothing changed, reply exactly [PASS].

`[PASS]` must be the whole final message. "Tests: [PASS]" or "[PASS] and a
summary" are ordinary replies.

## Matching

`isPassOutput(text)` in `packages/bb-studio/src/kit/silent` is the one matcher. It accepts
`[PASS]` in any case, with surrounding whitespace, backticks or markdown
emphasis (`` `[PASS]` ``, `**[PASS]**`, a fenced block). `isSilentOutput(text)`
also counts an empty reply. The kit exports `PASS_REPLY` and
`PASS_INSTRUCTION` for prompts.

Copies that can't import the kit say so and are tested against it:
`packages/bb-studio-mobile/notifications.ts` (the plugin installs alone) and
`ios/Shared/SilentOutput.swift`.

## What Studio does with a `[PASS]` turn

- **Phone push:** Studio Mobile sends none for a finished turn whose text is
  empty or `[PASS]`.
- **iOS:** a thread shows a faint one-line "Passed"; a Bot's chat hides it;
  the Bots list preview skips it.
- **Runners and heartbeats:** `[PASS]` is the "nothing to report" reply, and
  runners report only through `runner_report`, so it adds no Activity.
- **Desktop:** BB draws the chat rows, including a Bot's chat and runner
  threads, which open as BB's thread page. The pinned plugin SDK's timeline
  renderers only target tool rows and plugin row kinds, and message
  directives only render `::name` blocks inside a message, so nothing can
  hide or restyle a whole assistant message: a `[PASS]` shows as text.

## What BB does with it

On the BB Studio fork, Studio registers `isPassOutput` as BB's turn
classifier, so a `[PASS]` turn raises no unread mark, parent notice or push.
On a BB without that hook, BB still treats `[PASS]` as a normal reply and
Studio Mobile drops the push. See `docs/drafts/bb-issue-pass-output.md`.

## Phone pushes for a Bot

- **Main** is hidden, so BB never pushes it. Studio pushes Main's replies
  meant for the user (a real message, a work card or loop, the morning card)
  through Studio Mobile, unless Main's own BB level is input-only or muted.
  It sends none for `[PASS]`, an approval card alone, a cache keepalive, or a
  reply the user already read.
- **Workers** (leads, runners, agents' threads) are set to BB's input-only
  level when Studio records them, on the thread itself, so the global and
  worker defaults can stay "All activity". A level the user set stays.
  Studio sets it once on the workers that existed before.
- Studio Mobile drops BB's push for a keepalive or a silent relayed turn, and
  sends at most one reply push per conversation every 3 minutes.
