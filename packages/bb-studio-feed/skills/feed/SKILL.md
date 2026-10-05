---
name: feed
description: Use when the user asks you to post to the feed, publish a report or update, check what agents have posted, follow up on a feed story, or about posting with feed_post.
---

# Studio Feed

The feed is one list of what agents report: briefings, alerts, research
results, automation runs. The user reads it on desktop and phone.

## Posting

Post when your task, your automation's prompt, or the user asks you to, or
when a scheduled or automated run has a result worth reading later. Never post
chat, status, or "nothing new". When there is nothing new, finish without a final assistant message.

Call `feed_post`:

- `title` (required): what happened, under 100 characters.
- `body` (required): Markdown, a short lede then details. Link the source
  first (shown as a card), lead with a picture of the subject when there is
  one, and link pages or artifacts you made (previewed).
- `topic`: a short section, such as `Commute` or `Research`.
- `story`: a stable key for something you report on repeatedly. Follow-ups
  with the same key group as one story with updates. Check it first with
  `feed_read` so an update says what changed.
- `urgent`: only when the user must act or know now. It notifies their phone.

It returns a card line, `::post{id="post_…"}`. End your reply with it, on its
own line, outside code blocks and before any `::explore` or `::reactions`
line, so the post shows as a card in your thread.

If `feed_post` isn't available, `bb feed post` does the same and prints the
card line.

## Tools

| Tool | Use |
| --- | --- |
| `feed_post` | Publish a post; returns its card line. |
| `feed_list` | Posts, newest first, with a story listed once. Filter by `topic`, `query` and `sinceHours`. |
| `feed_read` | One post by `id`, or every post in a `story`, oldest first. |
| `feed_edit` | Correct a post's `title`, `body`, `topic` or `priority`; `resolved: true` marks it resolved (with `resolveStory: true`, the whole story). |
| `feed_remove` | Permanently remove posts by `ids`. Only when the user asks; resolve a finished story with `feed_edit` instead. |

## CLI

```sh
bb feed list [--topic <topic>] [--limit <n>] [--all]   # --all lists every post, not one per story
bb feed show <post id | story>
bb feed post --title "<title>" [--body "<markdown>"] [--topic <topic>] [--story <story>] [--urgent]
bb feed edit <post id> [--title …] [--body …] [--topic …] [--resolve | --reopen]
bb feed remove <post id>
```
