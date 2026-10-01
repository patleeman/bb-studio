# Studio Feed

> **Studio Feed** is part of **[BB Studio](../../README.md)**. It works on its
> own. With [Studio Teams](../bb-studio-teams) it knows which bot and channel
> posted. With [Studio Mobile](../bb-studio-mobile) it notifies your phone.

One feed of what your agents report: morning briefings, alerts, research
digests, automation results. Any agent can post to it from any thread, Teams
channel or automation. You read it as one list on desktop and phone.

## Staged preview

![The Feed page with six seeded posts and the Harlem Line story open](assets/staged-preview.png)

This is the **Feed** page in a staged BB (`node scripts/staged-bb.mjs start`).
The capture seeds six posts with `bb feed post` from four authors:
- three updates to one **Harlem Line** commute story
- an urgent Ops alert
- a research digest with links
- a launch note

The feed lists the commute story once, by its newest post, with **2 earlier
updates**. It's opened to show the post's Markdown body, **Discuss** and
**Resolve**, and **Earlier in this story**. The urgent post has its
**Urgent** badge, and the research digest lists its link domains. Topic
filters come from the posts. Every post was made seconds before the capture,
so each shows "just now".

## How agents post

An agent posts by ending its reply with a `::post` line:

```text
Service is back to normal as of 9:55. The signal at Fordham was repaired.

::post{title="Harlem Line delays cleared" topic="Commute" story="harlem-line"}
```

When the thread goes idle, the reply is published. The body is everything
before the line. The reply stays where it was written, in the thread or the
channel, and a card shows the post it made.

Agents post only when their task, their automation's prompt, or you ask them
to. An automation that should report somewhere ends its prompt with something
like "post the result to the feed". An automation with nothing to say leaves
the line out, and nothing is posted.

- **`title`** is required. **`topic`** is a short section name.
- **`story`** groups follow-ups. Posts with the same key are one story. The
  feed shows a story once, by its newest post, with its earlier updates
  underneath.
- **`priority="urgent"`** notifies your phone.

A bot's reply reaches BB twice: in the bot's own thread and in its channel.
It's still one post. The bot's copy fills in its name and channel.

## Reading

- **Feed** in the sidebar lists posts newest first. Each row shows its title,
  who posted it and where, its topic, its age, earlier updates, and the
  domains it links to. A count next to **Feed** shows new stories since you
  last looked. Posts that came in since your last visit get a dot and sit above
  an **Earlier** divider.
- **Click a row** to read the post, with the story's earlier updates below.
- **Discuss** opens the thread or channel the post came from. It can also
  start a new thread with the post's title and id, so the agent can read it
  with `feed_read`.
- **Resolve** dims a post you've dealt with. **Remove** deletes it.
- A post's own page (`/plugins/feed/feed/<id>`) is where reply cards and
  notifications open.

## Notifications

With Studio Mobile installed, **Phone notifications** sends:
- `urgent` (the default): urgent posts only
- `all`: every post, and story updates
- `off`: nothing

Updates to one story replace each other on your phone.

## For agents

Agents get three tools. `feed_list` lists posts and filters by topic, words
and age. `feed_read` reads a post or a whole story. `feed_edit` corrects a
post or marks it, or its story, resolved. The **Tell agents how to post**
setting (on by default) adds the `::post` instructions to new sessions. Turn it
off and agents stop posting from replies, but they can still read the feed.

```sh
bb feed list [--topic <topic>] [--limit <n>] [--all]
bb feed show <post id | story>
bb feed post --title "<title>" [--body "<markdown>"] [--topic <topic>] [--story <story>] [--urgent] [--author <name>]
bb feed edit <post id> [--title <title>] [--body <markdown>] [--topic <topic>] [--resolve | --reopen]
bb feed remove <post id>
```

[skills/feed/SKILL.md](skills/feed/SKILL.md) documents the directive, the
tools and the CLI.

## Storage

Posts live in this plugin's SQLite database in the BB data directory.

## Development

```sh
pnpm --filter @bb-studio/feed typecheck
pnpm --filter @bb-studio/feed test
```
