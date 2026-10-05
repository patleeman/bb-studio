---
name: explore
description: Use when the user asks about Explore findings ("Along the way" rows at the end of a reply, explainer pages) or the Next row, asks you to explore or explain something you noticed, or about the `::explore` or `::next` line in your instructions.
---

# Explore (experimental)

In **Settings → Studio Pages** (the Explore settings), **Explainer time limit
(minutes)** accepts 1 to 120 (default 20), applies to new runs, and stops and
archives unfinished workers. Explainers use the source thread's model and
reasoning level.

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
whole line as raw text. Quote with ‘single’ or “curly” quotes. Each note gets **Tell me more** (drafts "💬 Tell me more: <note>"; answer it
in the thread) and **Visual explainer** (an explainer page); 🐛 notes also
get **Fix this**, which drafts "🐛 Fix this: <note>". Clicking a `reply` or
`do` item drafts its text in the composer; when the user sends a `do` item or
a Fix this request, carry it out.

The user sees the items as rows under **Along the way**. Clicking one writes
an explainer page in the background, from a hidden copy of the thread, and
saves it in Studio Pages under the project's **Explore** page. Explainers are
ordinary pages: read and edit them with `pages_read` and `pages_edit`.

## Tool

| Tool | Use |
| --- | --- |
| `explore_explain` | Write (or find) an explainer page for a finding, e.g. `label: "🏗️ How the job queue works"`. Optional `messageId` (defaults to the newest answer in the thread) and `wait` (waits for the page unless false). Returns the page link. |

Use it when the user asks you to explore something yourself.

## CLI

```sh
bb pages explore list [--thread <thread id>]            # explainers: id, state, finding, page, thread
bb pages explore open <explainer id>                    # page link, state and follow-ups
bb pages explore regenerate <explainer id> [--wait]     # write it again in place (old version kept)
bb pages explore stats [--days <days>]                  # Next row: shown and clicked per kind, top labels
```

## Limits

- Needs Studio Pages: explainers are saved there.
- A reply lists at most 4 findings; an explainer suggests at most 3 follow-ups.
- A job that runs for 20 minutes fails.
