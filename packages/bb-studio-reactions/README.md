# Studio Reactions

> **Studio Reactions** is part of **[BB Studio](../../README.md)**. It works on its own and doesn't need the Studio collection.

Emoji reactions on replies, in the text selection menu and the bar under
each message. It started as a port of NeonPilot's `system-reply-actions`
extension.

Select any text in an agent response, and the floating selection menu (next
to "Add to chat") shows one emoji button per configured reaction. Clicking
one drafts a reply:

```
> <the highlighted text>

👍 Agree
```

and focuses the composer. Each reaction is a user-configurable emoji + label
pair, editable in BB's settings form for the plugin. The **Saved reactions**
section previews the stored choices and reports whether this window needs to
reload before message menus use them.
The reaction buttons show the emoji only (the host renders plugin actions
with the plugin's compact icon — identical for every reaction — so a content
script swaps that icon for the emoji glyph in the per-message action bar and
strips it from the floating selection menu), while the drafted reply uses
the full `emoji label` text.

Optional **smart reactions** (off by default) let the assistant suggest the
reactions that fit each reply, such as `🪶 SQLite` and `🐘 Postgres` when it
asks you to choose. They appear as buttons inside the reply. See
[Smart reactions](#smart-reactions).

## Smart reactions

Smart reactions are off by default. Turn them on with the **Smart reactions**
toggle in settings. When they are on, the assistant suggests reactions that fit
each reply that needs an answer. They appear as buttons under the message.
Clicking one drafts that reaction in the composer, the same way the other
reaction buttons do.

The assistant uses your configured reactions when they fit. When a reply
offers distinct choices, it writes specific ones, such as `🪶 SQLite` and
`🐘 Postgres`. Replies that need no answer get no buttons.

This works through a message directive. The plugin adds instructions that ask
the assistant to end such a reply with one line:

```
::reactions{items="🪶 SQLite|🐘 Postgres|❓ Clarify"}
```

The frontend draws that line as buttons. Items are separated by `|`, so
labels can contain commas. The plugin shows at most 5 items, drops items longer
than 60 characters, and drops items without both an emoji and a label.

- Studio Pages' [Next row](../bb-studio-pages/README.md#next-row) offers
  quick replies too, along with things to explore and actions. Its replies
  follow this setting: with smart reactions off, the Next row offers none.
  While Pages is enabled with the Next row on, smart reactions add no
  instructions of their own; the Next row carries your saved reactions
  instead, so agents aren't asked for two lines.
- Instructions apply when a thread's agent session starts or resumes, so turn
  the setting on before you start a thread. A running session keeps the
  instructions it started with.
- The buttons still render if you later turn the setting off, so older replies
  never show the raw line. If you disable the plugin, the line shows as plain
  text.

## Staged preview

![Live BB screenshot of Studio Reactions settings](assets/staged-preview.png)

Captured from isolated stable BB at checkpoint `38f64b5`. The native settings
form is the only reaction editor. It shows the default reaction list, all
three location toggles enabled, and Smart reactions off. The saved preview
below confirms these menu settings are applied in this window. Live checks
also verified the pending reload notice, each location toggle independently,
emoji-only selection entries, and cleanup when the plugin is disabled.

![Smart reactions under a live assistant reply](assets/smart-reactions.png)

A live thread in the staged BB, run on GPT-6.1-Sol with smart reactions on. It
asked whether to use SQLite or Postgres for a small todo app, and the
assistant's reply ends with its suggested reactions, SQLite and Postgres. With
Pages installed, as here, they show as the **Reply** row of Pages' "What next?"
card; without it, as Studio Reactions' own buttons. The capture accepts either,
then clicks SQLite and checks that the reply was drafted in the composer. The staged BB passes the thread's ID as
`BB_CAPTURE_SMART_REACTIONS_THREAD_ID`.

## Settings

- **Reactions** (`emojiItems`) — up to eight `emoji label` items, separated by lines or commas.
  Each item appears as one button in the selection menu and is used verbatim
  as the drafted reply text. Empty removes all reaction buttons.
  Default: `👍 Agree, 👎 Disagree, ✅ Do it, ❓ Clarify`
- **Quote the highlighted text** (`quoteSelection`) — when enabled (default),
  reacting drafts the highlighted text as a quote block, so the agent sees
  exactly what you reacted to.
- **Quote position** (`quotePosition`) — where the quote goes relative to the
  reaction text: `before` (default) drafts the quote first, then the reaction;
  `after` drafts the reaction first, then the quote.
- **In the text selection menu** (`showInSelectionMenu`) — when enabled
  (default), reactions appear in the floating text-selection menu and the
  right-click context menu.
- **Under assistant messages** (`showInAssistantBar`) — when
  enabled (default), reactions appear as buttons at the bottom of assistant
  messages (the per-message action bar).
- **Under your messages** (`showInUserBar`) — when enabled
  (default), reactions appear as buttons at the bottom of your own messages.

- **Smart reactions** (`smartReactions`) — off by default. When enabled, the
  assistant suggests reactions for each reply that needs an answer. See
  [Smart reactions](#smart-reactions).

Disable any surface you don’t want — at least one must stay enabled for
reactions to be visible. The three location toggles let you keep only the selection menu, only the
bottom bars, or a mix.

Edit them in the plugin's single host settings form, or via the CLI:

```sh
bb plugin config emoji-react set emojiItems "👍 Agree, 👎 Disagree, ✅ Do it"
bb plugin config emoji-react set quoteSelection true
bb plugin config emoji-react set quotePosition before
bb plugin config emoji-react set showInSelectionMenu true
bb plugin config emoji-react set showInAssistantBar true
bb plugin config emoji-react set showInUserBar false
bb plugin config emoji-react set smartReactions true
bb plugin reload emoji-react
```

After saving, **Saved reactions** shows the stored reaction list and whether
message menus in this window still use the earlier settings. **Reload window
to apply** refreshes those menus. Applying never disables or re-enables the
plugin, and a failed settings save stays in BB's normal settings form.
Other open windows use the new menu settings after their next reload.
Smart-reaction instructions use saved settings when a thread starts or resumes.

## How it works

- `messageAction` slots add one selection-menu entry per configured reaction
  (bb's equivalent of NeonPilot's `selectionActions` + `settingItems`).
  Registrations are static per frontend interpretation, so `app.tsx` reads
  the plugin settings synchronously at setup time (same-origin XHR to the
  plugin settings endpoint) and falls back to the defaults when the server
  is unreachable. If every `showIn*` toggle is off, no actions are registered
  — the plugin is effectively hidden until a location is re-enabled.
- A zero-visibility composer banner (the kit's `ComposerBridge`) registers
  each mounted composer — `messageAction` runs are plain host-chrome callbacks
  with no hook access, and banners mount in every composer layout. A reaction
  drafts into the composer for the message's thread, else a new-thread
  composer, never another thread's.
- BB's host settings form is the only editor. The plugin's settings section
  previews saved choices and compares them with this window's setup snapshot.
  The default reaction list is retained if reading that snapshot fails.
- Smart reactions: `server.ts` keeps the settings in memory and, when
  `smartReactions` is on, returns instructions from `bb.agents.configure`.
  `app.tsx` registers a `reactions` message directive that renders the
  suggested items as buttons. `src/smart-reactions.ts` parses the untrusted
  directive attribute and builds the instructions.
- The small `src/action-decoration.ts` host adapter identifies actions only by
  this plugin's icon plus a configured reaction title. It swaps the icon for
  an emoji in message bars and removes the redundant icon in selection menus.
  Role-specific visibility uses explicit role attributes and stable BB’s
  message container classes; unknown roles stay
  visible unless both message-bar locations are off. It restores every owned
  icon and visibility change when the plugin generation ends, and never targets
  unrelated buttons just because they share an emoji label.

## Develop

```sh
bb plugin install .    # register
bb plugin dev          # watch loop: rebuild + reload on save
pnpm typecheck
pnpm test              # vitest for reaction parsing, drafts, and smart reactions
pnpm build             # self-contained dist/
```
