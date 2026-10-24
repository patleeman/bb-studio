# Needs you: the Bot is the triage layer

Branch `bb/needs-you-meaning-clearing-reason-claude-thr_nuz8fqhxwf`, on top of
`origin/main` (`c8cbc412`). Not shipped.

Patrick's report: "Security · Runner" sat in the Bot sidebar's **Needs you**
with no way to clear it, and nothing in it needed him. His direction after the
first fix (a reason line, auto-clearing and Mark handled):

> needs you under bots shouldn't be a thing? The bot should be handling it all.

So this branch removes Needs you. The Bot triages, and the Bot's own row is
the only place that asks for Patrick's attention.

## The model

1. **The Bot is the triage layer.** Runner reports, urgent alerts, failures
   and the questions its threads ask go to the Bot. It handles them, or tells
   Patrick in its own chat. Patrick never triages runners directly.
   - An urgent `runner_report` still posts its line into the Bot's chat and
     pushes to the phone. Its agent-only note now asks the Bot to triage:
     "if you can handle it yourself, do. If the user must act, tell them in
     one or two short lines what happened and what to do. If it needs
     nothing from them, reply exactly [PASS]" (`TRIAGE_NOTE`,
     `src/runners.ts`).
   - "Stopped after failing" lines (auto-resume past its cap, for automations
     and for threads) carry the same kind of note (`STOPPED_NOTE`,
     `server.ts`): fix it if you can, tell the user if they must act, else
     [PASS].
   - **Its threads' questions**: BB's notice when a thread stops on a
     question reads like it finished ("@thread … completed: Waiting for your
     vault selection"), and the Bot replied `[PASS]` to it. So when a thread
     a Bot owns starts waiting on an answer (`interaction.pending`), Studio
     sends the Bot one agent-only note (`src/bot-nudge.ts`): "Your thread
     "<title>" (<link>) is waiting on an answer: <the question>. If you can
     handle it, do (answer it in that thread) and reply exactly [PASS]. If
     only the user can, ask them in a line or two here, with its link."
     Once per waiting episode: `bot_nudges` remembers it until a turn starts
     or ends with nothing pending, so the next question nudges again. "Owns"
     means the Bot's runner, a thread it owns, or a thread started from
     those (up to four levels up). Not for the Bot's own chat (its question
     is already the badge) or a paused or stopped Bot.
   - The Bot's instructions say so, inside the existing 800-character
     budget: "You triage: reports, alerts and your threads' questions come
     to you. Your chat is the user's inbox: post only what changed or needs
     them (a thread waiting on them: what it needs, linked); …"
2. **No Needs you section** in the Bots sidebar or in Bot info → Activity,
   on desktop or iOS. `bot_activity` no longer has `needsYou`.
3. **The one signal is on the Bot's row**: `attention` (`src/bot-attention.ts`)
   is set while the Bot's own chat has something waiting on Patrick:
   - a pending question or approval in the chat, until it's answered;
   - Bot replies he hasn't read (newer than the chat's `lastReadAt`, not
     empty and not `[PASS]`), until he reads the chat.

   It has a reason, a count and a time: "Asked you a question", "Waiting for
   approval", "1 thing for you", "2 things for you". `bot_activity` returns
   it, and `bot_attention { botId }` returns it alone, for Bot rows that
   aren't expanded.
4. **Runner rows show state only**: running, next …, quiet, reported, failed,
   paused, offline. No attention flag of their own. A runner whose last run
   failed shows "failed"; the Bot decides whether to bother Patrick.
   `RunnerView.urgent` and `bot_runner_seen` are gone, and a migration clears
   every existing urgent flag (`UPDATE bot_runners SET urgent = 0`).
5. **Threads the Bot started that wait on a question or approval** are the
   Bot's. They show under **Running** by their state: the amber "waiting
   for you" mark (as in the shared row-state spec, the same on iOS),
   "waiting" on the right, and `waitingFor` ("Waiting for an answer",
   "Waiting for approval") in the tooltip and in Bot info. The Bot's
   `bot_activity` tool lists them as "Waiting on an answer (yours to handle,
   or bring to the user)".
6. **Mark handled is dropped**, with `bot_needs_you_dismiss` and
   `bot_needs_you_restore`. Nothing needs it: the badge clears when Patrick
   reads or answers the Bot's chat.

## Desktop

- **Bot row** (the expanded Bot): a dot on the avatar, the count beside the
  name, and the status line says why ("1 thing for you") in place of what
  the Bot is doing. The tooltip reads "Dot: 1 thing for you".
- **Reading clears it**: while the Bot's current chat is the open thread and
  the page is visible, Studio marks it read (`threads.markRead`) each time
  something new waits there. In the staged BB, opening the hidden Bot chat
  didn't update its `lastReadAt` by itself, so Studio doesn't rely on BB for
  this. iOS marks a thread read when it's viewed.
- **Other Bots' rows**: the same dot, count and tooltip, from
  `bot_attention` (polled every 30 s).
- **Running**: a thread held by an approval or question shows as waiting,
  with the amber mark.
- **Bot info → Activity**: no Needs you. Running shows "waiting for
  approval" / "waiting for an answer" on such a thread.

## iOS

- **Activity sheet**: no Needs you, no swipe or menu. When the Bot needs
  Patrick, the sheet starts with a "<Bot> · Asked you a question" row and its
  count; tapping it goes to the chat. Running lists the waiting thread with
  its `waitingFor` as a muted second line.
- **Bell badge**: counts `attention.count`, and VoiceOver reads the reason.
- **Chat header**: the Bot's status line shows the attention reason ("Asked
  you a question", "1 thing for you") instead of "Needs you".
- **Widgets and the watch complication** count the Bot's attention
  (`bot_attention`), not pending questions across all of BB. With an older
  Studio (no `bot_attention`), they fall back to the old count.
- **Duo sidebar**: the Chat row shows the reason and count.
- **Bots list**: each row gets a dot, the reason as its status line and a
  count, from `bot_attention`.
- **Runners**: state only; an urgent report reads "reported".

## Checked live on a staged BB

Stable BB 0.47.0 from `scripts/staged-bb.mjs`, seeded on `c8cbc412`, then
this branch's Studio installed into the same instance:

- Seeded Bot replies nobody had read: `attention` "2 things for you".
  `bb thread read` on the Bot's chat cleared it.
- A runner "Security" reported urgent "SSH on red4 accepts passwords again".
  With the triage note, the Bot replied "SSH on red4 has accepted passwords
  again since this morning. Restore key-only SSH access and check what
  re-enabled password authentication." That made "1 thing for you". When the
  same report came again, the Bot replied `[PASS]`: it had already told him.
- A runner "Backups" reported urgent "Last night's red4 backup failed: the
  backup disk is full." The Bot escalated it: "1 thing for you".
- The thread "Rotate the ORBIT-42 deploy key" asked a question. It shows
  under Running as "Waiting for an answer". Before the nudge, the Bot
  replied `[PASS]` to BB's notice about it; that's why the nudge exists.
- Runner rows: Deploy watch and Security show "reported", with no flag.
- Opening the Bot's chat from its row cleared the badge (the clip below).
- **The nudge** (round 3): the deploy-key thread asked again, and Studio
  sent the Bot one agent-only note: "Your thread "Rotate the ORBIT-42
  deploy key" (/projects/…/threads/…) is waiting on an answer: Which vault
  holds the ORBIT-42 deploy key? …". The Bot asked Patrick in its chat:
  "Which vault holds the ORBIT-42 deploy key: 1Password, AWS Secrets
  Manager, or Vault? Answer in @thread:…". The badge read "2 things for
  you" (it had also posted "I'll check whether the vault choice is already
  recorded."). No second note came while the thread kept waiting.

## Renders

Desktop: before is Studio at `c8cbc412`, installed from GitHub; after is this
branch, installed into the same staged instance. Dark and light, at 2x.
`render.mjs` in this folder makes both:
`node docs/needs-you/render.mjs before|after`. The after views open a project
thread, not the Bot's chat: an open chat counts as read, so the badge would
clear.

| View | Before | After |
|---|---|---|
| Bots sidebar, dark | ![](before/sidebar-dark.png) | ![](after/sidebar-dark.png) |
| Bots sidebar, light | ![](before/sidebar-light.png) | ![](after/sidebar-light.png) |
| Bot info → Activity, dark | ![](before/info-dark.png) | ![](after/info-dark.png) |
| Bot info → Activity, light | ![](before/info-light.png) | ![](after/info-light.png) |

The badge clearing when the Bot's chat is opened (dark, the whole window):
[read-clears.mp4](after/read-clears.mp4), and as a GIF:

![](after/read-clears.gif)

iOS (dark, demo fixture `-qaBotAttention`, `UITests/BotAttentionCaptureUITests.swift`):

| View | Before | After |
|---|---|---|
| Phone, Activity | ![](ios/before-phone.png) | ![](ios/after-phone.png) |
| Duo | ![](ios/before-duo.png) | ![](ios/after-duo.png) |
| Phone, Bots list | n/a | ![](ios/after-phone-botlist.png) |
| Phone, the Bot's chat header | n/a | ![](ios/after-phone-chat.png) |
| Widgets (the status widget's views drawn in the app: small, circular, medium, rectangular) | n/a | ![](ios/after-widget.png) |

The widget render is the widget's own view drawn inside the app
(`-qaStateDemo widgets`), not a home-screen capture: unsigned simulator
builds may not share the app group. No watch render: the harness has no
watchOS path.

## Tests

- `src/bot-nudge.test.ts`: one agent-only note per waiting episode, with the
  thread's title, link and question; no repeat while it still waits; a new
  episode after it's answered nudges again (an approval says so); none for
  the Bot's own chat, an unowned thread or a paused Bot; a failed send can
  try again.
- `src/bot-attention.test.ts`: reasons and counts; only unread replies that
  aren't `[PASS]`; approval beats question; what a waiting thread says.
- `src/bot.test.ts`: attention from a question in the Bot's hidden chat,
  until answered (and `botAttention` alone); from unread replies, until the
  chat is read; a thread held by an approval is in Running with
  `waitingFor` and gives no attention; runner threads stay out of Activity;
  the triage line is in the Bot's instructions.
- `src/runners.test.ts`: urgent posts the line with `TRIAGE_NOTE` and pushes;
  the runner keeps no flag; Studio's own alert likewise.
- `src/migrations.test.ts`: the migration clears urgent flags.
- `src/ui/bot/BotHome.test.tsx` (also: the open Bot chat is marked read only
  while something waits), `workspace.test.ts`,
  `ProviderStatusMark.test.ts`, `Runners.test.tsx`: no Needs you group; the
  Bot row's dot, reason, count and tooltip; another Bot's row from
  `bot_attention`; the waiting thread under Running, with the amber mark;
  runner tones without urgent.
- iOS: `BotThreadsTests`, `BotRowStateTests`, `BotChatTests`, `BotTests`
  (attention decoding, `waitingFor` in Running, runners without urgent,
  `bot_attention` scoped by `botId`). Full `BBStudioTests`: 350 tests,
  1 skipped, 0 failures.

## Decided (round 3)

- The Bot gets a nudge when one of its threads waits on an answer (above).
- The badge keeps counting unread Bot replies, including replies to
  Patrick's own messages: it works as the Bot chat's unread count.
- iOS chat header shows the attention reason; widgets and the watch count
  the Bot's attention.
- The waiting mark is amber on both platforms.

## Still open

1. **Older Studio with this iOS build**: iOS no longer reads `needsYou`, so
   waiting threads from an older Studio show nowhere on iOS (the widgets fall
   back; the Activity sheet doesn't).
2. **README screenshots** `bot.png` and `bot-runners.png` still show Needs
   you. They need a capture run from a pushed commit
   (`scripts/capture/captures/bb-studio-bot.mjs` is updated for it).
3. **Widgets with Studio but no Bot**: `bot_attention` answers "nothing", so
   the widgets show 0, not BB's pending-question count. The fallback is only
   for a Studio without `bot_attention`. Should "no Bot" also fall back?
4. **iOS chat header truncates** the reason on a phone ("Asked you a
   questi…") beside the call and bell buttons.
5. `Widgets/StatusWidget.swift` is now also built into the app target, for
   the in-app widget render.
6. Reloading or reinstalling Studio cancels a pending `design_ask` question
   (seen while staging). That's BB's plugin-interaction behaviour, not this
   change.
