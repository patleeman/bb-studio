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

`isPassOutput(text)` in `@bb-studio/kit/silent` is the one matcher. It accepts
`[PASS]` in any case, with surrounding whitespace, backticks or markdown
emphasis (`` `[PASS]` ``, `**[PASS]**`, a fenced block). `isSilentOutput(text)`
also counts an empty reply. The kit exports `PASS_REPLY` and
`PASS_INSTRUCTION` for prompts.

Copies that can't import the kit say so and are tested against it:
`packages/bb-studio-mobile/notifications.ts` (the plugin installs alone) and
`apps/ios/Shared/SilentOutput.swift`.

## What Studio does with a `[PASS]` turn

- **Phone push:** Studio Mobile sends none for a finished turn whose text is
  empty or `[PASS]`.
- **iOS:** a thread shows a faint one-line "Passed"; a Bot's chat hides it;
  the Bots list preview skips it.
- **Runners and heartbeats:** `[PASS]` is the "nothing to report" reply, and
  runners report only through `runner_report`, so it adds no Activity.
- **Desktop:** BB draws the chat rows. The pinned plugin SDK's timeline
  renderers only target tool rows and plugin row kinds, not assistant
  messages, so a `[PASS]` shows as text.

## What BB does not do yet

BB itself still treats `[PASS]` as a normal reply: it posts the parent's
"child completed" notice, sends its own push and marks the thread unread. See
`docs/drafts/bb-issue-pass-output.md`.
