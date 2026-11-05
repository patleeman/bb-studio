# BB Studio Visual Chat (prototype)

Part of BB Studio. Visual Chat is a chat where the agent answers on a board
(a canvas), like someone at a whiteboard. It isn't a transcript. Each turn, the agent edits the board to
show what matters now: it adds, changes and removes charts, numbers,
tables, captions and generated widgets. Every change animates, so you can
see what moved. You never arrange the board.

BB Studio Visual Chat is its own plugin (id `studio-visual-chat`) and is off
unless you install it. It needs Studio. It was BB Studio Canvas (id
`studio-canvas`), and before that Canvas (id `canvas`); see
[Moving from BB Studio Canvas](#moving-from-bb-studio-canvas).

## Staged preview

![A canvas after one real agent turn in a staged BB](assets/staged-preview.png)

The canvas page in a staged BB, after one real agent turn on the staged
BB's default provider: the agent built the board with the canvas tools,
and its short reply is the caption line at the bottom.

## Use it

Open **Visual Chat** in BB's rail, or go to `/plugins/studio-visual-chat/canvas`. Type what
you want to look at. The chat is one faint line at the bottom: the agent's
latest reply, a text field, Talk's dictation mic, a history peek and the
hands-free button.

- **Text:** each message goes to the canvas's thread. A message sent while
  the agent works waits its turn.
- **Dictation:** the mic dictates into the field with Studio's Talk. While
  you talk, Talk's controls (timer, cancel, stop-and-insert, and a ▾ menu)
  sit in the field, as in the thread composer. The text lands in the field
  for you to edit or send; nothing is sent on its own.
- **Hands-free voice:** starts Studio's hands-free voice speaking for the
  canvas. The voice edits the board while it talks, and passes deeper work
  to the canvas's thread, which edits the board when it's done.

## How it works

- **The agent** is an ordinary BB thread, hidden, in your personal
  project. Visual Chat makes it when you start a canvas, on Claude Code's
  Sonnet 5.5 (`claude-sonnet-5-5`). The thread is the canvas's memory; you
  see the board. Canvases made before keep the model their thread has.
- **The model picker** in the top bar lists the providers and models BB has,
  grouped by provider, with reasoning levels when a model has more than one.
  The pick is saved per canvas and applies from the next message: another
  model from the same provider changes the thread in place; another
  provider starts a fresh hidden thread that gets the rules, the guide, the
  board and the last few lines of talk.
- **The board is one page** the agent designs for each answer: HTML and CSS
  shaped by the content (a plan runs along a timeline, a showcase is a wall
  of pictures, a comparison sits side by side). It's in this plugin's own
  database, with a short log of what changed in each turn.
- **The page** renders in a sandboxed frame the size of the board (scripts
  in an opaque origin; nothing loads from the network but https pictures),
  with the style's tokens (`--cv-*`), the kit's classes and declarative
  charts (`data-chart`: line, columns, bars, stars, US tile maps, timelines
  and more; `src/ui/kit.ts`). It scrolls when it's taller than the screen.
- **Filling the screen:** in a page the type scale grows with the screen,
  `cv-fill` is a full-height layout (header, a stretching middle row,
  footer), and `cv.viewport()` gives the screen's size. A page that stops
  short is zoomed up (at most 1.4×) as far as it still fits.
- **Motion:** the agent marks parts with `data-cv-id`. When a new version
  arrives, the frame keeps its document and morphs the page: parts with the
  same id glide (FLIP) to their new place, changed ones fade their new
  content in, new ones enter and gone ones leave from where they were. A
  part whose id changed but shows the same picture or text glides too, and
  `canvas_page` tells the agent when it renamed most parts.
- **The canvas tools:** `canvas_page` (the whole board), `canvas_patch` (one
  part by id), `canvas_read`, `canvas_style`, `canvas_image`,
  `canvas_images` and `canvas_guide`. Only canvas threads get them, with the canvas rules and
  the `canvas` skill, and each works only on the calling thread's board.
  Hands-free voice gets the same tools.
- **The page streams:** for a new or rewritten page, the agent looks up
  every picture in one `canvas_images` call, then writes the page in its
  reply as one fenced html block (`` ```html ``, optionally with
  `style=… title="…"`), and one caption line after it. BB writes a reply's
  text to the thread's event log as it's generated
  (`item/agentMessage/delta`); tool input doesn't stream, which is why the
  page goes in the reply and not in `canvas_page`. While a canvas thread
  works, the server polls its log (`threads.events.list` after the last
  seq, every ~180 ms), assembles the text, takes the growing html block,
  repairs it (a half tag, attribute, entity or comment is dropped, a half
  `<style>` keeps its finished rules, a half `<script>` is dropped, open
  elements are closed) and publishes it over realtime, at most about 6
  times a second (`src/stream.ts`). The page reveals each `data-cv-id` part
  once its element is closed, with a short entrance; an open part with no
  finished part inside stays hidden (in a `cv-wall`, a pulsing tile holds
  its place), and an open part that holds finished parts shows them.
  Finished parts stay as they are on screen while the rest arrives, and
  found pictures go into cards as they appear. At idle the reply's final
  text is committed: the html block becomes the page and a version, as
  `canvas_page` would make it, and the words outside it the caption. The
  finished page lands on the streamed one with no flash. If the turn ends
  without a closing fence (or the final text is missing), what arrived is
  committed, repaired; with no html at all the board stays and the reply is
  the caption.
- **Which way a page goes up:** a new or rewritten page is the html block in
  the reply; `canvas_patch` changes one part; `canvas_page` is for a message
  from the hands-free voice (the voice reads the reply back, so that reply
  is only the caption). Older boards, versions and the voice tools work as
  before.
- **Building blocks:** `data-block="card"` (a picture with its title,
  rating with source and a line), `stat` (a big figure with its evidence),
  `step` (a timeline row), `side` (a comparison column), `quote` and
  `placeholder`, declared in a few `data-*` attributes the kit expands, in
  the containers `cv-wall`, `cv-steps` and `cv-sides`. They're optional.
- **Pictures:** `canvas_images` looks a batch up in one call, in parallel;
  `canvas_image` finds one. Each returns an https address with alt text and
  its source. A query goes to Exa when an Exa API key is set, else to
  Wikipedia (its search API, then the best article's page image); a pageUrl
  takes that page's main picture (og:image, else the largest image). Found
  pictures are cached for a day, in memory and in the plugin's database.
  Each picture goes into the card whose `data-cv-id` is its key, on the
  page at once (so a draft shows them) and on every later version, so the
  agent never writes picture addresses into the page.
  Server-side fetches go only to public http(s) addresses: each
  hop's host is resolved once, every address checked, and the connection
  pinned to that address (so a resolver can't switch it after the check),
  with a time limit and a size cap. Picture addresses lose tracking
  parameters. Stars without a source read "my pick".
- **Exa API key:** a BB secret setting on this plugin, `exaApiKey`
  (**Settings → Plugins → BB Studio Visual Chat**, or `bb plugin config
  studio-visual-chat`). It's only sent to Exa: never logged, returned or put in
  an error. Without it, pictures come from Wikipedia.
- **Tool loading on Claude Code:** Claude Code defers every plugin tool
  behind its tool search unless `ENABLE_TOOL_SEARCH` says otherwise, which
  cost each turn a ToolSearch round. On its own threads only, Visual Chat
  sets `ENABLE_TOOL_SEARCH=auto` (through the SDK's
  `bb.providers.experimental_contributeEnv`), so tools load up front while
  their definitions stay under 10% of the context window, and Studio gives
  these threads none of its tools. Above the threshold Claude Code defers
  them after all; the instructions then name the exact `select:` query.
- **Styles:** Editorial (a magazine spread), Field notes (a designer's
  whiteboard) and Instrument (a control room) are token sets. The agent
  picks one per board, a style you ask for wins, and the top bar shows it.
- **Title and caption:** the canvas's title is the topic the agent names
  (the fence line's `title`, or `canvas_page`'s), else the page's first
  heading. The caption is the reply's line after the html block; with
  `canvas_page` the agent sends it as `caption`, so it shows with the page,
  and its reply repeats it (the reply wins if it differs, and it's what a
  voice reads back). The caption is written to add what the board doesn't say;
  sentences that describe the board ("The board shows…") are dropped from
  it.
- **Versions:** each turn's finished board is saved as a version: its
  page, style, title, the message that led to it and the caption (a page
  still streaming and mid-turn patches aren't versions). ‹ › and "3 / 7" beside the chat
  line page back and forward, with the same glide, and so do ← and → while
  the field is empty; hovering shows each version's message. A message
  sent from an old version continues from it: the board goes back to that
  version, the agent is told so, and the new version comes after the
  others, which stay. The last 50 are kept per canvas. A canvas from before
  versions starts with its board as it was as version 1 (a board of items
  shows as it was). `canvas_read` says when the user is looking at an old
  version.
- **Boards from before pages** (items placed by the old layout) still open
  and show as they were. The agent's next page replaces them.

## With Studio

The page reuses Studio's widget renderers, markdown and theme. They're
bundled into this plugin (`bundle/canvas-ui.js`, built by `node build-ui.mjs`),
so Visual Chat reads nothing of Studio's at runtime except through these:

- Studio's hands-free voice asks this plugin's `canvas.voice` and
  `canvas.voiceRun` RPCs when a session starts from a canvas thread.
- The page starts hands-free with a `bb-studio:handsfree-start` window
  event, and dictation uses Talk's `data-talk-field` events.

## Development

```sh
node build-ui.mjs   # after changing src/ui or the Studio files it uses
```

`scripts/capture/canvas-demo.mjs` records four text turns and a hands-free
turn in a staged BB. `scripts/capture/canvas-directions.mjs` runs real turns in
one canvas and saves light and dark stills after each, with the style the
agent picked. `scripts/capture/canvas-composition.mjs` runs real turns at two
window sizes, light and dark, and can pause a page's morph for a
mid-animation still. `scripts/capture/canvas-stream-timing.mjs` runs one
prompt in new canvases on a real model and times the first visible content,
the first real card, the final page and the turn, with the model's rounds,
and can record the page building.

## Moving from BB Studio Canvas

A plugin's data is keyed by its id, so canvases made under BB Studio Canvas
stay in `<BB data dir>/plugins/studio-canvas/data.db` (and ones from the
first Canvas plugin in `<BB data dir>/plugins/canvas/data.db`). The first
time Visual Chat starts with no canvases of its own, it copies every canvas
in from the BB Studio Canvas file, or, when that file isn't there, from the
Canvas one: pages, items, changes, history, thread aliases, model choices
and found pictures, keeping their ids. Each canvas keeps its hidden thread,
so old links (`/plugins/studio-canvas/canvas/<threadId>` becomes
`/plugins/studio-visual-chat/canvas/<threadId>`) and hands-free voice find
it.

- It opens the old file read-only and never changes or deletes it.
- It runs once and records that it ran (`canvas_legacy_import`).
- Disable the old plugin before installing this one, so the two don't both
  run. You can uninstall the old one once you've checked your canvases.
- Settings don't move: they belong to the old plugin's id. Paste the Exa API
  key (if you use one) into BB Studio Visual Chat's `exaApiKey` setting.
