# Studio Pages

> **Studio Pages** is part of **BB Studio**, a suite of plugins for writing, talking, drawing, and keeping what your agents make. See the [suite overview](../../README.md).

Collaborative documents for BB that you write together with your agents.
Pages gives you a Notion-style block editor with live multiplayer editing,
comments, charts, embeds, and ordinary agent chats.

With Studio Talk installed, the microphone in a comment box lets you dictate
new comments, replies, and edits. Stop dictation to insert the transcript at
the cursor, then review it and post when ready. The page body stays separate.

## Staged preview

![The compact Pages header](assets/compact-header.png)

The live 390-pixel "Offline mode launch" page keeps **Chat** visible while
**Item actions** is open with Related, Open in split, Dictate, Comments and the
page menu. The standalone phone capture
also checks that Version history remains reachable through Page actions.
These compact captures run on stable BB 0.45.0 with the full suite installed
from pushed commit 306c841. They check viewport bounds, button hit targets,
and the Related popover before capture.

![A Pages document with stats, a chart, and a checklist](assets/staged-preview.png)

This is the real BB **Pages** panel in a staged BB (`node scripts/staged-bb.mjs start`), opened from the nav panel. The capture
script uses the plugin's own `create` RPC to seed three project pages:
- "Offline mode launch"
- a nested "Rollout risks" sub-page
- "Release notes: October"

The launch page is open. It holds:
- a tip callout
- a stats block with three key numbers and their deltas
- a stacked bar chart of weekly active teams
- a launch checklist with two items done

At the top left is the **Studio** / "Offline mode launch" breadcrumb. At the
top right are **Chat**, Related, Open in split, **Dictate**, **Version
history**, **Comments** and the page menu. **Dictate** appears because Talk is installed in the staged app.

![Standalone Pages Chat with its retained draft](assets/standalone-chat.png)

The capture shows Pages' own **Chat about "Offline mode launch"** composer in
the main view, holding its retained draft and `release-review.txt`. The
standalone Chat check temporarily disables Studio in the isolated
staged app. It resumes a legacy page conversation without creating another
thread, then opens **New conversation** in the main view. Its draft and
file survive navigation to another page and back, and a browser reload. The
desktop check also schedules a second page's conversation, opens the new
thread in the main view, and verifies its page context, edited prompt,
attachment, and updated Chat action. The
[phone capture](assets/standalone-chat-mobile.png) keeps every composer
control inside the viewport. All fixture sends are scheduled and their threads
are deleted before any agent runs. The capture restores Studio and
removes its pages and files.

```sh
BB_CAPTURE_STANDALONE_CHAT=1 \
  BB_CAPTURE_ONLY=pages-standalone-chat,pages-standalone-chat-mobile \
  node scripts/capture-plugin-screenshots.mjs --plugin pages
```

![The Pages Comments panel with a microphone in the reply box](assets/comments.png)

This staged page has an anchored comment and a reply. The capture checks real
microphone start/stop, dictation delivery into both drafts, explicit Save,
and an unchanged page body. The reply microphone also fits in the
[phone comment sheet](assets/comments-mobile.png).

![The Pages collection listing the seeded pages](assets/collection.png)

The collection is what the **Pages** nav item opens. It shows:
- Studio search, filtered to `Kind: Pages`, with **Clear filters**
- the Space, Kind and **More filters** menus and **Save view**
- **New** in the header
- the three seeded pages, with their project and last activity

"Rollout risks" shows the page it sits in. The script deletes its three pages
afterwards.

## What you get

- **A block editor.** Built on [BlockNote](https://www.blocknotejs.org): type
  `/` for headings, lists, checklists, toggles, quotes, code, tables, images,
  video, audio, files, and the custom blocks below. Blocks can be dragged,
  nested, and turned into other types. Markdown shortcuts work as you type.
- **Live collaboration.** Every page is a Yjs document synced over a
  WebSocket. Agents edit the same document from the server, so their
  changes stream into your editor, with cursors, while you keep typing.
- **Code and diagrams.** Code blocks are syntax-highlighted for about
  twenty languages, in light and dark. A `mermaid` block renders its
  diagram; click it to edit the source.
- **HTML blocks.** An `html` block runs its HTML, CSS, and scripts in a
  sandboxed frame (no access to BB, its cookies, or storage) that grows to
  fit its content. Click its label to edit the source.
- **A card in the agent's reply.** When an agent creates or changes a page,
  its reply shows the page's card (`::page{id="…"}`). The card shows the
  page's text inline, read-only, and updates as the page changes. The chevron
  hides or shows the text; the choice is remembered for every Studio card.
  Click the title or the arrow to open the page in a **Pages** tab in the
  thread's workbench, beside the chat. Where there's no workbench, it opens
  in the main area.
- **In a thread's workbench.** The **Pages** tab lists the thread's pages
  (the ones made or changed in it, and the page it was started from), then
  the project's recent ones. **New** makes a page in the thread's project and links it to
  the thread in Studio. A page opens in its live editor, with a link to the
  full page.
- **Custom blocks.** Callouts, charts (bar, line, area, pie), stat rows, and
  embed cards for links, BB threads, and other pages. Paste a link on an
  empty line to turn it into a card; web links fetch their title,
  description, and preview image.
- **Studio embeds.** The `/` menu's Studio group embeds a drawing, artifact,
  recording, or live table, picked by search, or makes a new table or
  drawing in the page's project and embeds it.
  Embeds stay live:
  - a table is the full Studio Tables grid, edited in place, with its views,
    board and calendar; the view shown is kept with the page;
  - a recording plays in the page, with its summary, decisions and
    transcript; click a line to play from there;
  - a drawing is an inline whiteboard: it shows the drawing, and **Sketch**
    (or a double-click) adds a pen, an eraser and five colors. Strokes save
    to the Studio Draw drawing as ordinary Excalidraw elements, merged with
    other edits, so **Open in Draw** shows them in the full editor. `/whiteboard`
    makes a new drawing in the page's project and opens it ready to draw.
    Pages draws the scene as plain SVG and doesn't load Excalidraw;
  - an artifact shows its content (images, HTML, PDFs, code, text).

  Pasting a link to a Studio item embeds it too, and a link to a table view
  embeds that view. A basic table's block menu (⋮⋮) has **Turn into
  database**, which moves its cells into a new Studio table, the first row
  as column names, and embeds it in its place.
  Charts and stats are edited as JSON, which makes them easy for agents to
  write.
- **Mentions.** Type `@` to mention another page, a BB thread, a
  Studio item, or a date. Page and thread mentions open where they point.
- **Comments.** Select text to comment on it. Threads show in a floating
  card where you can reply, react, edit, and resolve. Agents can read, start,
  reply to, and resolve threads. Clients without the editor, like the BB
  Studio phone app, use the `comments`, `commentBlocks`, `commentCreate`,
  `commentReply` and `commentResolve` RPCs, which write as you.
- **A collection of pages.** The **Pages** nav item lists every page, with
  search over titles and content, filters, a project filter, and sorting and
  grouping from **Display**. **New page** opens a blank full-page document.
- **Projects and nesting.** Pages belong to a project or are global, and
  nest to any depth, with a breadcrumb back up. Give a page an emoji icon,
  move it, archive it, or delete it from its ⋯ menu.
- **Chat about a page.** With [Studio](../bb-studio) installed, **Chat**
  opens beside the page, in a split: the page's linked thread, or a new
  conversation with the page as context. **Choose conversation…** picks
  another. Without Studio, Pages keeps its own composer and history, and
  conversations open in BB's main view at
  `/plugins/pages/pages/<id>/compose`, with drafts and attachments kept as you
  move between pages. Sending starts an agent thread in the page's project.
- **Version history.** Pages saves a version before an agent's first
  edit in a while. You can save one yourself and restore any version, and the
  current page is saved before a restore.

## Dictation with Talk

With [Studio Talk](../bb-studio-talk) installed, you can dictate into a
page:

- The **Dictate** button at the top right, or **Dictate** in the `/` menu, starts Talk. Press
  **Stop dictation** or ✓ in Talk's pill to finish, and the transcript goes in
  at your cursor. Blank lines in the transcript start new paragraphs. If you
  haven't clicked into the page yet, the text goes at the end.
- *Talk: Start or finish dictation* from the command palette works while the
  cursor is in a page.
- If you finish while you're somewhere else, Talk keeps the text. Its **Go
  back** button reopens the page, and the text is added when the page loads.

Talk does the recording, transcription, and durability. Pages only marks the
editor as a Talk dictation field and inserts the text Talk hands it. Without
Talk, the dictation controls are hidden.

## For agents

Agents get nine tools: `pages_list`, `pages_read`, `pages_create`,
`pages_edit`, `pages_comments`, `pages_comment`, `pages_comment_reply`, and
`pages_comment_resolve`, plus `explore_explain` (see [Explore](#explore)). `pages_read` returns Markdown with a block id on the
line before each block, and `pages_edit` applies small operations against those ids. An
agent can then change one checklist item or paragraph without overwriting
what you are typing.

The same actions are available from the CLI:

```sh
bb pages list [--all]
bb pages show <page-id|title> [--ids]
bb pages create <title> [--global] [--markdown <text>]
bb pages append <page-id|title> <markdown…>
```

[skills/pages/SKILL.md](skills/pages/SKILL.md) documents the tools, the
Markdown extensions (charts, stats, HTML, embeds, callouts, mentions), and the agent
workflows.

## Storage

In **Settings → Studio Pages**, **Saved versions per page** controls history
retention. The default is 50. Set 1 to 1000 to keep that many versions, or 0
to keep all. Lowering the limit removes older versions when that page next
saves a version. Existing pages use the new limit without a restart.

Pages, versions, uploads, and historical requests live in the plugin's SQLite
database in the BB data directory. Uploads are limited to 15 MB each and are
served back through the plugin's HTTP route.

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
bb plugin build .
bb plugin install . --yes
```

BlockNote's menus and toolbars are styled with Tailwind classes that live in
`node_modules`, which `bb plugin build` doesn't scan. `blocknote-tailwind.txt`
lists them so the build generates them. After upgrading `@blocknote/shadcn`,
run `pnpm tailwind:blocknote` to regenerate it.

## Templates and export

Studio can duplicate a page with its subpages, mark a page as a template, and instantiate it with `{{name}}` variables. The provider exports Markdown with uploaded assets, printable HTML with those assets, or a text PDF. Use Studio's New menu to start from a saved template.

## Checklists and agents

A checklist item is a unit of work. **Hand to agent** (in the item's ⋮⋮
menu, or `/hand to agent` on the item) starts a thread in the page's project
with the item as its prompt and a mention of the page. Pages puts a mention
of that thread at the end of the item, labelled with the thread's state:
**Agent · starting**, **working**, **needs input**, **replied**, **failed**,
**archived** or **deleted**. Click it to
open the thread. Check the item off yourself after reviewing; the agent is
told not to.

## Explore

Explore is experimental. Agents end answers that read code with a few things they noticed **Along the way**; clicking one writes an explainer page under the project's **Explore** page, opened in the thread's panel (its **Explore** tab), or on its own page when the thread panel isn't available. Agents can write an explainer themselves with the `explore_explain` tool. Explore keeps its explainers in its own `explore.db` next to Pages' database. The CLI is `bb pages explore list|open|regenerate|stats`.

Explore's settings appear in Pages' settings with an **Explore:** prefix: **End replies with a Next row** (on), **Suggest things to explore** (on), and **Explainer time limit (minutes)** (20). They apply to agent sessions started after the change.

### Next row

With **Explore: End replies with a Next row** on (the default), agents end a reply with one compact **What next?** card instead of separate lines. Each row has a short label saying what its buttons are for; hover a label for more:

- **Reply**: quick answers to this message, when it asks you something. These follow Studio Reactions: they appear only while it's installed with **Smart reactions** on, and the agent prefers your saved reactions. Clicking a reply or a request drafts it for you to send.
- **Ask for**: things the agent offers to do next, such as "📄 Write this up as a page" or "🧵 Start a thread to fix the retry bug".
- **By the way**: what the agent noticed along the way, told back to you in plain sentences: "I noticed the new endpoint retries without waiting between tries. If the server is down, it will get hammered." Each has **Tell me more**, which drafts "💬 Tell me more: <note>" so the agent explains it right there in the thread, and **Visual explainer**, which writes an explainer page with diagrams in the background and then opens it. Notes marked 🐛 also have **Fix this**, which drafts a request to fix it.

The agent writes it as one line, and any group can be left out:

```
::next{reply="👍 Ship it|🧪 Add tests first" btw="🐛 I noticed the new endpoint retries without waiting. If the server is down, it will get hammered." do="📄 Write up the plan as a page"}
```

The explainer's writer gets the whole note, not just a short label. Studio Reactions' smart reactions add nothing while the Next row is on. Pages logs each suggestion once when it's shown and counts its clicks. The log keeps the last 180 days (at most 50,000 suggestions). `bb pages explore stats [--days 30]` prints how often each kind (reply, explore for Visual explainer, do, fix, more for Tell me more) is clicked and the most-clicked labels, so the instructions can be tuned from real use. Older replies with `::explore` or `::reactions` lines, or `explore` items in `::next`, still render.
