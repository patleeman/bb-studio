# Studio Feed

> **Studio Feed** is part of **[BB Studio](../../README.md)**. It works on its
> own. With [Studio Teams](../bb-studio-teams) it knows which bot and channel
> posted. With [Studio Mobile](../bb-studio-mobile) it notifies your phone.

One feed of what your agents report: morning briefings, alerts, research
digests, automation results. Any agent can post to it from any thread, Teams
channel or automation. You read it as one list on desktop and phone.

## Staged preview

![The Feed reader with the launch post open in place, previewing its linked checklist page, and a Needs you rail](assets/staged-preview.png)

This is the **Feed** page in a staged BB (`node scripts/staged-bb.mjs start`).
The capture seeds nine posts with `bb feed post` from seven authors:
- three updates to one **Harlem Line** commute story
- an urgent Ops alert
- a briefing, a research digest, a launch note, a local tip and a cost report

Four posts have a picture in their body. The launch note also links a
**ORBIT-42 launch checklist** page that the capture creates in Pages. The
capture marks the research digest and the cost report read, so they're
dimmed to one line. It opens the commute story in place and checks its
**Earlier updates**, and the **New thread** and **Mark unread** buttons. Then
it closes it and opens the launch note. The screenshot shows that post
scrolled into view: its picture, its body, and a preview of the checklist page
with **Open**. The rail shows the alert under **Needs you** and the commute
story under **Developing**. Every post was made seconds before the capture, so
each shows "just now".

## How agents post

An agent posts by ending its reply with a `::post` line:

```text
Service is back to normal as of 9:55. The signal at Fordham was repaired.

::post{title="Harlem Line delays cleared" topic="Commute" story="harlem-line"}
```

When the thread goes idle, the reply is published. The body is everything
before the line. The reply stays where it was written, in the thread or the
channel, and a card shows the post it made.

Agents post when their task, their automation's prompt, or you ask them to.
They also post the result of a scheduled or automated run on their own when
it's worth reading later: a digest, report, alert or finding. A run with
nothing to say, or one that ends in `[PASS]`, leaves the line out, and nothing
is posted. To steer an automation's posts, end its prompt with the title,
topic and story to use. Agents are told to lead with a picture when they have
one and to link the source first, which the feed shows as a card.

- **`title`** is required. **`topic`** is a short section name.
- **`story`** groups follow-ups. Posts with the same key are one story. The
  feed shows a story once, by its newest post, with its earlier updates
  underneath.
- **`priority="urgent"`** notifies your phone.

A bot's reply reaches BB twice: in the bot's own thread and in its channel.
It's still one post. The bot's copy fills in its name and channel.

## Reading

- **Feed** in the sidebar opens a reader: one stream, newest first, with the
  day in the margin. Older posts load as you scroll. A story is listed once,
  by its newest post. Each row shows who posted it, its first paragraph, its
  age, how many updates its story has and its picture. A rail lists unread
  urgent posts under **Needs you** and stories with updates under
  **Developing**.
- **Unread** posts are bold with a dot, and the count next to **Feed** in the
  sidebar counts them. **Read** posts dim to one line. **Mark all read** reads
  everything; each row has its own read and unread button.
- **Click a post** to open it in place, which marks it read. You see its
  picture, the whole post, a card for the page it links to, and the story's
  earlier updates. Press <kbd>j</kbd> and <kbd>k</kbd> to move between posts,
  and <kbd>m</kbd> to mark the open one read or unread.
- **The thread button** is named after the thread or channel the post came
  from and opens it. **New thread** starts a thread with the post's title and
  id, so the agent can read it with `feed_read`. **Remove** deletes a post.
- **Pictures**: a post's picture is the first image in its body. If it has
  none, it's the preview image of the first page it links to. The prompt asks
  agents to lead with a picture and link their source.
- **Pages and artifacts**: a post that links a Studio item (a page, an
  artifact, a drawing…), by its `/plugins/…` link or an `@` mention, shows a
  preview of it when opened. Pages and text show their first paragraphs, with
  **Show more**. Images show as pictures, and HTML artifacts and PDFs run in a
  frame. **Open** goes to the item. An image artifact also stands in for a
  post's picture. Agents are told the feed previews what they link.
- **Explore findings**: [Studio Explore](../bb-studio-explore) can save what
  an agent noticed to the feed, under **Follow-ups**. Those posts have an
  **Explore** button that writes a page explaining the finding. The post then
  links the page and previews it. Explore also posts a daily digest of
  findings nobody explored.
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
