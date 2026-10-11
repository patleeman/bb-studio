---
name: explore
description: Use when the user asks about Explore findings ("Along the way" rows at the end of a reply) or the Next row, or about the `::explore` or `::next` line in your instructions.
---

# Explore (experimental)

When Explore is on (the *Suggest things to explore* setting), your
instructions ask you to end an answer that involved reading code with one
line of findings you noticed but didn't cover:
`::explore{items="🐛 Retry backoff disagrees in billing|🏗️ How the job queue works"}`.
It goes just before a `::reactions` line if there is one, otherwise last.

When the Next row is on (*End replies with a Next row*, the default), your
findings go in the `btw` attribute of one `::next` line instead, as notes back
to the user in plain sentences, next to `reply` (quick answers) and `do`
(actions you offer to take):
`::next{reply="👍 Ship it" btw="🐛 I noticed the new endpoint retries without waiting. If the server is down, it will get hammered." do="📄 Write up the plan as a page"}`.
Start each note with "I noticed", avoid code names, and say what it means for
the user. Never put a straight double quote inside an item; BB then shows the
whole line as raw text. Quote with ‘single’ or “curly” quotes. Each note gets
**Tell me more** (drafts "💬 Tell me more: <note>"; answer it in the thread);
🐛 notes also get **Fix this**, which drafts "🐛 Fix this: <note>". Clicking a
`reply` or `do` item drafts its text in the composer; when the user sends a
`do` item or a Fix this request, carry it out.

The user sees `::explore` items as rows under **Along the way**. Clicking one
drafts "💬 Tell me more: <item>"; answer it in the thread.

## CLI

```sh
bb studio pages explore stats [--days <days>]                  # Next row: shown and clicked per kind, top labels
```

## Limits

- A reply lists at most 4 findings.
