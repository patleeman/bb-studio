---
name: pages
description: Use when the user refers to a BB Page — a /plugins/pages/pages/<id> link, a page mention, "the launch page", a doc they want written or kept up to date — or asks you to read, write, comment on, or restructure a page, or how Pages and its Studio Teams integration work.
---

# Pages

**Settings → Studio Pages → Saved versions per page** controls history
retention: 50 by default, 1 to 1000 for a limit, or 0 to keep all. Lowering it
prunes older versions only when that page next saves a version. It never
changes the current page text.

Pages are collaborative documents inside BB. The user edits them live in the
Pages panel while agents and Studio Teams bots edit the same document through
tools. Every change merges in real time (Yjs), so nobody's typing is
overwritten.

Pages belong to a project or are global, and nest into a tree. Link to one as
`[Title](/plugins/pages/pages/<page-id>)`.

## Agent tools

| Tool | Use it to |
| --- | --- |
| `pages_list` | List this project's pages and global pages as a tree. Pass `query` to search titles and content. |
| `pages_read` | Read a page as Markdown. Each block is preceded by a `<!-- ^id -->` marker naming it; use those ids in edits. |
| `pages_create` | Create a page from Markdown. Set `global` for a global page, `parent` to nest it. |
| `pages_edit` | Apply small edit operations to a page (see below). |
| `pages_comments` | List comment threads with their ids, commented text, and replies. |
| `pages_comment` | Start a comment thread on a block, optionally on an exact quote from it. |
| `pages_comment_reply` | Reply in a comment thread. |
| `pages_comment_resolve` | Resolve or reopen a thread. |

Pages can be referenced by id (`pg_…`) or exact title.

### Editing without clobbering the user

Always `pages_read` first, then edit with targeted operations that reference
block ids (the full id or its first 8 characters):

- `insert_after` / `insert_before` a block, `replace` a block, `delete` a block
- `append` / `prepend` Markdown to the page
- `set_checked` on a checklist item
- `replace_text` inside one block, or the first match in the page
- `replace_all` — only when the user asks to rewrite the whole page

Pages saves a restore point before an agent's or bot's first edit in a
while, so the user can roll back from **Version history**.

## Markdown

Pages reads and writes GitHub-flavoured Markdown plus:

- **Callouts:** `> [!NOTE] text` (also `TIP`, `WARNING`, `CAUTION`, `IMPORTANT`).
- **Toggles:** `<details>` with a `<summary>` line, the hidden blocks, then
  `</details>`, each separated by a blank line. The summary takes inline
  Markdown; start it with `##` for a toggle heading. Toggles can nest.
- **Charts:** a fenced ` ```chart ` block holding JSON:
  `{"type":"bar|line|area|pie","title":"…","x":"label","series":["Revenue"],"stacked":false,"unit":"$","data":[{"label":"Q1","Revenue":10}]}`.
  `x` and `series` default to the first text column and the numeric columns.
- **Stats:** a fenced ` ```stats ` block holding 1–6 items:
  `[{"label":"ARR","value":"$1.2M","delta":"+8%","trend":"up","caption":"vs last month"}]`.
- **Mermaid:** a fenced ` ```mermaid ` block renders as a diagram.
- **HTML:** a fenced ` ```html ` block renders its HTML in a sandboxed
  iframe that grows to fit its content (up to 2,400px tall). Scripts run, but
  in an opaque origin: no cookies, storage, BB APIs, popups, or navigation of
  the page, and don't count on network access. Make it self-contained, with
  inline `<style>` and `<script>` and no external assets. The frame's
  `prefers-color-scheme` follows BB's light or dark theme, so style both,
  e.g. `@media (prefers-color-scheme: dark) { … }`, and leave the page
  background transparent so it sits on the page. The source is limited to 200,000 characters;
  longer ones show as an HTML code block instead. A bare ` ```html ` fence
  renders, so show HTML *source* as ` ```html source ` (how HTML code blocks
  read back) or with another fence language (` ```xml `).
- **Embeds:** a fenced ` ```embed ` block:
  `{"kind":"bookmark|thread|page|drawing|artifact|recording|task|board|table|item|space","target":"https://… or an id","title":"…"}`.
  Bookmarks may also carry `description` and `image`; leave them out and the
  editor fetches the link's preview when the page opens. `drawing`,
  `artifact`, `recording`, `task`, `board`, and `table` take the item's id
  in Excalidraw, Artifacts, Talk, Studio Tasks, or Studio Tables; a table may
  name a view as `<table id>/view/<view id>`, and a board (`brd_…`, from
  `tasks_boards`) shows as a checklist with `<board id>/view/list`. `item` embeds anything in
  Studio, with `plugin:id` as the target (`studio_list_items` lists ids). A
  drawing shows its picture, an artifact its content, a table its live grid,
  a task an editable card, a board its columns of draggable cards, a recording its player and transcript, and the
  rest a card. To give a page a database, make it with `tables_create` and
  embed it as a `table`; to track work in it, make a board with
  `tasks_board_create` and embed it as a `board`.
  A Studio space's page holds `space` widgets with target
  `<space id>/<section>`, where section is `actions`, `recent`, `threads`,
  `channels` or `projects`; they show that part of the space live. Leave them
  in place when editing a space's page unless the user asks otherwise.
- **Mentions:** `@[Name](bot:bot_id)`, `@[Title](page:pg_id)`,
  `@[Title](thread:thr_id)`, `@[Title](item:plugin:id)`,
  `@[2026-10-01](date:2026-10-01)`.

Tables, checklists (`- [ ]`), headings, quotes, and images work as in GFM.
Code fences keep their language and are highlighted for TypeScript,
JavaScript, JSON, Python, shell, Go, Rust, SQL, HTML (` ```html source `),
CSS, YAML, Markdown, diffs, Java, Kotlin, Swift, C, C#, TOML, Dockerfile,
GraphQL, and XML.

## Working from a page

The page header's Chat action continues its conversation or opens BB's
new-thread composer. New conversation starts another. Sending starts a
normal agent thread in the page's project, shown through the shared
workbench/Float companion system or ordinary thread navigation when Float
is absent. Existing page chat links still work. The thread also appears in
the sidebar, and its header links back to the page. Its first message carries the page id and
its Markdown with block ids as hidden context. The copy can go stale as the
user types, so read the page again right before you edit it with
`pages_edit`. This works without Studio Teams.

## Studio Teams integration

These need the Studio Teams plugin. Each request runs in the bot's own DM thread
with its configured model and reasoning level.

- **@mention a bot in a page.** Typing `@` and picking a bot in the page
  sends it the surrounding block as a request, plus the page. The bot edits
  the page and usually leaves a comment on that block saying what it did.
- **@mention a bot in a comment.** The bot answers in the same thread. Bots
  that have already replied in a thread see every new human reply there.
- **Hand off from the page composer.** Mentioning a bot in the page's
  "Work with this page…" box sends it that message as a request about the
  page.
- **Keep updated.** A page can have an owner bot, a cron schedule, and
  instructions. On each run the bot brings the page up to date. **Refresh
  now** runs it immediately.

Requests show in the page's **Activity** menu as queued, working, done, or
failed. Picking one opens its thread through the shared companion system.

When you are a bot handling one of these requests, follow its instructions:
edit with `pages_edit`, then reply in the named comment thread with
`pages_comment_reply` or start one with `pages_comment`.

## Dictation

With the Talk plugin installed, the user can dictate into a page: **Dictate**
in the header, `/dictate`, or *Talk: Start or finish dictation* while the
cursor is in the page. Talk records and transcribes, and Pages inserts the
text at the cursor, or at the end if the user hasn't clicked into the page.
Text finished elsewhere is added when the user goes back to the page.
Dictation edits the page as the user, not an agent. Recordings are in Talk's
Recordings page (`bb talk list`).

## CLI

Output is bounded and tab-separated where it is a list.

```sh
bb pages list [--all]                                   # this project + global; --all for every project
bb pages show <page-id|title> [--ids]                   # Markdown; --ids adds block id markers
bb pages create <title> [--global] [--markdown <text>]  # prints the new page id
bb pages append <page-id|title> <markdown…>             # "\n" in arguments becomes a newline
```

## Limits

- Uploaded files (images, video, audio, files) are limited to 15 MB each.
- `pages_read` returns up to 60,000 characters.
- Deleting a page deletes its sub-pages. Archive it instead to keep it.
