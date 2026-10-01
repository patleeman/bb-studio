---
name: feed
description: Use when the user asks you to post to the feed, publish a report or update, check what agents have posted, follow up on a feed story, or about the `::post` line in your instructions.
---

# Studio Feed

The feed is one list of what agents report: briefings, alerts, research
results, automation runs. The user reads it on desktop and phone.

## Posting

Post only when your task, your automation's prompt, or the user asks you to.
Make the post your final reply: the Markdown body, then on its own line:

```text
::post{title="Harlem Line delays cleared" topic="Commute" story="harlem-line"}
```

- `title` (required): what happened, under 100 characters.
- `topic`: a short section, such as `Commute` or `Research`.
- `story`: a stable key for something you report on repeatedly. Follow-ups
  with the same key group as one story with updates. Check it first with
  `feed_read` so an update says what changed.
- `priority="urgent"`: only when the user must act or know now. It notifies
  their phone.

The line goes after the body and outside code blocks, before any `::explore`
or `::reactions` line. Your reply stays in your thread or channel, with a card
for the post. The same reply arriving through a bot's thread and its channel is
one post.

## Tools

| Tool | Use |
| --- | --- |
| `feed_list` | Posts, newest first, with a story listed once. Filter by `topic`, `query` and `sinceHours`. |
| `feed_read` | One post by `id`, or every post in a `story`, oldest first. |
| `feed_edit` | Correct a post's `title`, `body`, `topic` or `priority`; `resolved: true` marks it resolved (with `resolveStory: true`, the whole story). |

## CLI

```sh
bb feed list [--topic <topic>] [--limit <n>] [--all]   # --all lists every post, not one per story
bb feed show <post id | story>
bb feed post --title "<title>" [--body "<markdown>"] [--topic <topic>] [--story <story>] [--urgent]
bb feed edit <post id> [--title …] [--body …] [--topic …] [--resolve | --reopen]
bb feed remove <post id>
```
