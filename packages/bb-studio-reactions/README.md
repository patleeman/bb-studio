# Studio Reactions

> **Studio Reactions** is part of **[BB Studio](../../README.md)**. It works on its own and doesn't need the Studio collection.

Emoji reactions on replies, in the text selection menu and the bar under each
message. Its plugin id is `emoji-react`.

Select text in a reply. The floating selection menu (next to "Add to chat")
shows one emoji button per reaction. Click one and the composer gets a draft,
then focus:

```
> <the highlighted text>

👍 Agree
```

Buttons show the emoji only. The draft uses the full item text. An item can be
just an emoji (`🚀`); then the draft is that emoji.

The draft goes to the composer for the message's thread, in the main view or a
split. If that thread has none open, a new-thread composer takes it. Another
thread's composer never does. With no usable composer, a toast asks you to open
the thread's composer.

**Quote position.** With `before` (default) the quote comes first, then the
reaction. With `after` the reaction comes first, then the quote. If you
already typed a draft, `after` puts the reaction between your text and the
quote.

## Smart reactions

Off by default. When on, the assistant ends a reply that needs an answer with
suggested reactions, such as `🪶 SQLite` and `🐘 Postgres`, shown as buttons
under the message. Clicking one drafts it, with no quote. Replies that need no
answer get no buttons.

The plugin asks the assistant for one last line:

```
::reactions{items="🪶 SQLite|🐘 Postgres|❓ Clarify"}
```

- The assistant prefers your saved reactions and writes specific ones when a
  reply offers distinct choices. It is asked for 2 to 5 items, each an emoji
  and a label of up to 5 words.
- The line comes from the model, so the plugin checks it. It keeps at most 5
  items, drops items over 60 characters, items without an emoji and a label,
  and duplicates. In the instructions, your saved items lose `"` and `|`, and
  the list is capped.
- Instructions apply when a thread's agent session starts or resumes. Turn the
  setting on before you start a thread.
- Buttons still render if you later turn the setting off, so old replies never
  show the raw line. If you disable the plugin, the line shows as plain text.
- **Studio Pages' [Next row](../bb-studio-pages/README.md#next-row)** offers
  quick replies too. While Pages is running with the Next row on, smart
  reactions add no instructions, so agents aren't asked for two lines. The
  Next row then uses your saved reactions when smart reactions are on. If Pages
  is missing, off, failed, or slow to answer, smart reactions apply as usual.
  The plugin rechecks Pages on system changes, at each session start, and every
  15 seconds.

## Staged preview

![Live BB screenshot of Studio Reactions settings](assets/staged-preview.png)

Captured from a staged stable BB at commit `306c841`. The native settings
form is the only reaction editor. It shows the default reaction list (Agree,
Disagree, Do it, Clarify), quoting before the reaction, all three location
toggles enabled, and Smart reactions on, as the staged BB sets it for the
live reply below. The saved preview
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

Edit these in BB's settings form for the plugin, or with the CLI.

| Setting | Key | Default |
| --- | --- | --- |
| Reactions: up to 8 `emoji label` items, separated by lines or commas. Empty removes the buttons. | `emojiItems` | `👍 Agree, 👎 Disagree, ✅ Do it, ❓ Clarify` |
| Quote the highlighted text | `quoteSelection` | on |
| Quote position: `before` or `after` the reaction | `quotePosition` | `before` |
| In the text selection menu (and the right-click menu) | `showInSelectionMenu` | on |
| Under assistant messages | `showInAssistantBar` | on |
| Under your messages | `showInUserBar` | on |
| Smart reactions | `smartReactions` | off |

If all three location toggles are off, no reactions show.

```sh
bb plugin config emoji-react set emojiItems "👍 Agree, 👎 Disagree, ✅ Do it"
bb plugin config emoji-react set quotePosition after
bb plugin config emoji-react set showInUserBar false
bb plugin config emoji-react set smartReactions true
bb plugin reload emoji-react
```

The plugin has no CLI commands of its own and no agent tools.

Message menus read the settings once when the plugin's frontend loads. The
**Saved reactions** section previews the stored list and says whether this
window still uses older settings; **Reload window to apply** refreshes the
menus without disabling the plugin. Other open windows update on their next
reload. Smart-reaction instructions use saved settings when a thread starts or
resumes.

## How it works

- `app.tsx` registers one `messageAction` per reaction. It reads the settings
  synchronously at setup (the default list if the server is unreachable).
- The kit's `ComposerBridge` registers each mounted composer, and
  `composerFor(threadId)` picks the one to draft into.
- `src/action-decoration.ts` swaps the plugin's icon for the emoji in message
  bars and removes it from the selection menu. It targets only this plugin's
  actions and restores everything when the plugin generation ends.
- `server.ts` returns the smart-reaction instructions from
  `bb.agents.configure`. `src/next-row.ts` tracks Pages' Next row.
  `src/smart-reactions.ts` parses and builds the directive.

## Develop

```sh
bb plugin install .    # register
bb plugin dev          # watch loop: rebuild + reload on save
pnpm typecheck
pnpm test
pnpm build             # self-contained dist/
```
