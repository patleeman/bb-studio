---
name: explore
description: Use when the user asks about Explore findings ("Along the way" rows at the end of a reply, explainer pages), asks you to explore or explain something you noticed, or about the `::explore` line in your instructions.
---

# Explore (experimental)

When Explore is on (the *Suggest things to explore* setting), your
instructions ask you to end an answer that involved reading code with one
line of findings you noticed but didn't cover:
`::explore{items="🐛 Retry backoff disagrees in billing|🏗️ How the job queue works"}`.
It goes just before a `::reactions` line if there is one, otherwise last.

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
bb explore list [--thread <thread id>]            # explainers: id, state, finding, page, thread
bb explore open <explainer id>                    # page link, state and follow-ups
bb explore regenerate <explainer id> [--wait]     # write it again in place (old version kept)
```

## Limits

- Needs Studio Pages: explainers are saved there.
- A reply lists at most 4 findings; an explainer suggests at most 3 follow-ups.
- A job that runs for 20 minutes fails.
