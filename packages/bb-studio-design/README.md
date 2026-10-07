# Studio Design

> **Studio Design** is part of **BB Studio**, a suite of plugins for writing, talking, drawing, and keeping what your agents make. See the [suite overview](../../README.md).

Design UI prototypes and slide decks with your agents. A design is a set of rounds; each
round holds a few options, and each option is one self-contained HTML screen.
The agent writes the screens, and you see them live on a canvas, play them,
and pin comments to their elements for the agent to act on. The plugin id is
`design`.

## Staged preview

![Live BB screenshot of a design open in Studio Design](assets/staged-preview.png)

Captured from a staged BB (`node scripts/staged-bb.mjs start`): the seeded
"Orbit onboarding" design open full screen at `/plugins/design/designs/<id>`.
Its one round, "Welcome screen", shows two live options side by side: `1a`, a
desktop welcome page for a release planner, and `1b`, the same screen at
phone size. The floating pill at the top left holds Reload and the
**Select** / **Comment** mode switch; the one at the top right holds Present
and the zoom controls, fitted at 74%. The capture checks the design's name,
the round and both option captions, both pills, and that each frame shows its
screen.

![Live BB screenshot of a three-step prototype splayed by step](assets/staged-prototype.png)

The seeded "New release flow" design: one mobile prototype that declares
three steps (Name the release, Pick a checklist, Release created). The canvas
splays it into one live frame per step, each opened at its step through the
URL hash, with a Play button on each.

## What you get

- **Designs in Studio.** With [Studio](../bb-studio) installed, designs are a Studio kind next to pages, drawings and tables: create, move, rename, duplicate, archive, delete and export. Without Studio, the **Designs** panel lists them.
- **Card in the agent's reply.** When an agent makes or changes a design, its reply shows a card (`::design{id="…"}`) with the newest round's first screens. The name or arrow opens the design in the thread's **Design** tab beside the chat. Opened without a design, the tab lists the thread's designs.
- **Full-screen view** (`/plugins/design/designs/<id>`): the design under Studio's item header, with an editable name and the design's chat.
- **Canvas.** Drag the background or hold Space to pan. Pinch, or hold ⌘ and scroll, to zoom. Rounds stack newest first, each with a title and intro. Each option is a live frame at its real size (desktop 1280×800, tablet 834×1112, mobile 390×844, slide 1920×1080, square, story, A4, Letter, email, or any `WIDTHxHEIGHT` from 200 to 4000 px a side) that you can click and type in. Screens update as the agent writes them.
- **Prototype steps.** A multi-step flow is one screen that declares its steps with a `bb-design-steps` meta tag. The canvas shows one frame per step, each opened at that step.
- **Slide decks.** Ask for slides and the agent first shows 2–3 visual directions, each a title slide and a content slide, and asks you to pick one. It then writes the deck as one `slide` screen whose steps are its slides. The canvas lays the slides out four to a row, and the card in the reply reads "Deck · N slides". **Play** presents the deck: ←/→, Space, Page Up/Down, Home and End move between slides, and **Full screen** presents it alone.
- **Saved styles.** After you pick a direction, the agent saves it as a named style: the system in words and the CSS that carries it. Before the next design or deck, it offers your saved styles as a starting point, so you can skip the round of directions. Styles aren't in `bb studio backup` yet.
- **Player.** **Play** on a frame, or **Present** for the newest option, opens the screen over the canvas, live, at the chosen step. It has Fit, Fill, **Export PDF** and **Download HTML** (the screen's file, without Studio's preview script). Export PDF opens the print dialog with one page per slide or step at the frame's exact size; choose Save as PDF there.
- **Comments.** In **Comment** mode, click an element to pin a note. **Send to agent** posts the comment, with the element's selector and markup, to the design's thread. It waits for a running turn to finish. You can also resolve or delete comments.
- **Questions.** When the brief or look is open, the agent calls `design_ask`. A form appears in the thread with choices, multi-select, short answers and 1 to 5 scales, up to 12 questions, each with "Decide for me". The answers return as one "Questions answered" list. If you close the form, the agent proceeds with defaults.
- **Reviewer.** When the agent calls `design_ready`, a separate reviewer agent runs in a hidden thread. It uses Browser Automation to load each screen and step at its size (desktop screens also at phone width), checks overflow, small touch targets, clipped text and console errors, and looks at the screenshots. Only a "needs work" verdict comes back, as findings in the design's thread. The canvas shows **Reviewing…**, **Reviewed**, **Needs work** or **Review failed**. A review times out after 15 minutes. A `design_ready` call during a review queues one more review of the latest screens. `skipReview` marks a round ready without a review.
- **3-round pause.** After 3 reviews in a row find problems, automatic review pauses for that design and the agent must tell you so. It resumes when you rename the design, add, send, resolve or delete a comment, change the design in Studio, or ask for another review. Review status is kept in memory, so a restart clears it.
- **Backup.** `bb studio backup` includes each design with its rounds, screens and comments. See [Backup and restore](../../docs/backup.md).

## Agent tools

`design_list`, `design_create`, `design_rename`, `design_read`, `design_ask`, `design_ready`, `design_write_screen` (a whole screen), `design_edit_screen` (replace one exact snippet), `design_comments`, `design_resolve_comments`, `design_save_style` and `design_styles` (list, read or delete saved styles).

The `design` skill tells agents how to work: ask only what they can't find out, match the project's design system, make two or three different options per round, keep small edits small, write flows as one prototype with steps, and build decks by picking a direction first.

The plugin has no CLI commands and no settings.

## How it works

- Designs, rounds, screens and comments live in the plugin's SQLite database (`~/.bb/plugins/design/data.db`), owned by `src/server/store.ts`.
- Each frame loads from the plugin's `/screen` route. The response carries a sandbox CSP, so a screen gets an opaque origin with no access to BB, its cookies or its API. Fonts, images and scripts may load over https.
- Every write publishes a realtime signal, so open canvases refetch, and tells Studio the collection changed.

## Development

```
bb plugin install .     # register (path install; server.ts loads from source)
bb plugin dev           # watch: rebuild frontend + reload on every save
bb plugin build .       # emit dist/ (server.js + app.js/app.css)
```

The README captures are in `scripts/capture/captures/design.mjs`. They create each design with Studio's `studio_create` RPC and write its screens with the plugin's `DesignStore` into the staged data directory.
