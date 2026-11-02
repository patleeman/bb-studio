# Attention Router backend

The store lives in Studio SQLite. The appended migration adds `bot_loops`
(records validated by the shared Zod schema), `loop_events` (append-only history),
and durable scheduler bookkeeping. All timestamps are Unix milliseconds.
The phone keeps saved places and coordinates. Studio receives only place names
and arrive/leave events; it never stores location history.

## RPC and tools

The public Studio contract exports these method names verbatim, including dots:

- `loops.list({area?,owner?})`: needsYouNow, comingUp, agentsOnIt,
  waitingOnOthers and done (closed in the past seven days). A queued or
  snoozed loop is Coming up whoever owns it, waiting for its trigger; Agents
  on it is started work (in progress or handed off). `held` says why a due
  loop of Patrick's waits: `budget` (the day's cards are spent) or `morning`
  (low priority, for the morning card). `owners` names each `thread:<id>`
  owner by the thread's title ("(archived)" once archived), with `threadId`
  null once the thread is gone.
- `loops.get({id})`: loop, chronological history, and `owner` for a thread owner.
- `loops.add({text})`: create a draft owned by cos, then send the Bot an
  agent-only message through `threads.send` to interpret it with loops_update.
  The server makes no LLM calls. An active Bot chat is required for delivery.
- `loops.update({id,changes?,surfaceNow?})`: update fields; surfaceNow queues
  immediate release through the same budget and quiet-hour policy.
  Setting an open status (such as `surfaced`) on a closed loop reopens it,
  clearing closedAt and recording `reopened`: Undo on a Done card.
- `loops.act({id,action,option?,owner?,snooze?})`: done, drop, got_it and choose
  close; snooze changes the trigger; hand_off changes owner and starts work;
  nudge and keep record an action. choose requires an existing decision option.
  Closed actions are idempotent. hand_off defaults to cos; a thread owner is
  `thread:<id>`. Handoffs, nudges and choices tell the Bot to take the next step.
- `loops.fire({event})`: match a named event and latch eligible triggers as due.
- `loops.place({place,direction})`: fire `place:<name>:arrive|leave`. A place
  key is its name in lower case, so `Home` fires `place:home:arrive`, which
  the `home` snooze waits on. Saved place triggers are lower-cased too.
- `loops.setPlaces({names})`: the phone replaces its list of saved place names
  whenever its places change (at most 20, 60 characters each, deduplicated
  ignoring case). Names only, never coordinates. `loops.places({})` returns
  `{names}` for Change trigger on the desktop.
- `loops.morning({})`: date in the configured zone, top five Patrick-owned due
  or decide items ranked urgent/normal/low then due, `more` count, and
  `lowPriority` queued items. The CoS supplies calendar and good-to-know lines.

An event trigger takes an optional `label` in words ("when Unraid fixes the
PHP CVE"); without one the UI prettifies the event key.

Agent tools: loops_add accepts structured fields; loops_list, loops_get,
loops_update, loops_act, loops_fire and loops_morning mirror the APIs above. These are included
in Studio's agent configuration. Capture tools should avoid duplicating pending
Bot questions; a source `{kind: 'interaction', ref: '<interaction id>'}` also lets
the badge deduplicate an explicitly tracked interaction.

### Discussing a loop in the chat

Patrick brings a loop into the Bot chat to talk about it (`src/loops/reference.ts`):

- **Discuss**, first in each row's ⋯ menu in the pane and a row action on the
  Loops tab, puts an `@loop` mention chip at the end of the Bot chat's draft
  with `composer.insert` and focuses it; nothing is sent. On the tab it opens
  the chat first and waits for its composer. Studio registers the `loop`
  mention provider (`@loop` works in any composer too); at send time it
  resolves to the loop's id, title, why and trigger, agent-only.
- **Dragging a pane row** into the composer drops `::loop{id="…"}` and
  "About: <title>" as `text/plain`. BB's composer (ProseMirror) inserts plain
  text where it's dropped. It can't take a chip: BB's own thread drag into
  the composer is a pointer drag with an in-memory registry, not HTML5 drag
  data, and SDK 0.6.37 has no drop API for plugin mentions.
- loops_get reads one loop by id. Its description and loops_list's say a
  `::loop{id="…"}` line or a Loop mention in Patrick's message makes that
  loop the topic.

## Directives for the UI worker

Render `::loop{id="loop_..."}` by fetching loops.get and acting through loops.act.
There is no new morning directive: the Bot composes a normal message with loop
links/cards. Show `+N more` from morning.more and link it to the Loops tab.
The weekly message likewise contains loop directives for Keep/Drop actions.
Studio cannot append an assistant message directly: it sends an agent-only
request to the Bot, asking it to post the directive once through its normal reply.
The UI worker must implement directive rendering and iOS category/action handlers.

## Morning card

The Bot writes the morning card as one normal message in exactly this shape
(the loops_morning tool description says so). Desktop and iOS draw a message
holding a `row="1"` loop or `::loops{more}` as one card:

```text
## Monday, Nov 2
**Calendar**
- 9:30 AM · Standup · Zoom
**On today's list**
::loop{id="loop_…" row="1"}
::loops{more="3"}
**Good to know**
- Rain from 3 PM. Take an umbrella.
```

- One `::loop{id="…" row="1"}` line per `morning.items`, in order: a compact
  row (icon, title, due) that opens the full card.
- `::loops{more="N"}` is "N more in Loops", opening the Loops tab. Leave it
  out when `more` is 0.
- At most three "Good to know" lines, personal only (no Kensico or tech news).
  Leave out any empty section.
- A plain `::loop{id="…"}` stays a full card.

## Release policy

One server scheduler ticks every minute. Event and place matching is durable:
a match becomes a due time trigger, so quiet hours do not lose the event.
Time and none triggers release when eligible, at any hour. Only Patrick-owned
loops release as cards; low priority waits for the morning list. The daily cap
counts surfaced history in the configured zone, cards released at night
included. Quiet hours hold pushes only, never cards. Urgent bypasses quiet
hours and budget. Surface now uses this same policy. A loop the CoS or a thread
owns starts when its time trigger comes (a fired event latches as one): the
Bot is told to carry it out and the loop turns in_progress, with no card and
no budget. Turning `loopsEnabled` on ticks the scheduler at once, so loops that
queued while it was off release without waiting. A successful Bot request records surfaced; failed requests retry.
The surfaced state prevents duplicate cards on subsequent ticks and restarts.
Push failure retries independently. A successful notify records notified; an
overdue loop may notify again on a later local day. Urgent or push:true loops
notify through Mobile. Nonurgent pushes respect quiet hours.

Monday at or after 09:00, the scheduler asks the Bot to list loops with no update
for over three days. A durable local-date key prevents repeating it that day.
Actions and edits reset the stale clock.

Snooze values: later_today = +3h; tonight = next 19:00; tomorrow_morning = next
08:00; this_weekend = next Saturday 10:00; home = home arrive; mac = next morning
07:45 (phase 2 placeholder, no Mac presence detection). Wall times use the configured
time zone, including DST.

Settings (Studio settings, `bb studio settings`): `loopsEnabled` (label **Attention Router**, in Threads, default **OFF**) gates all
scheduled releases, cards, stale messages, pushes and loop badge counts. Tools and
RPC remain usable for testing while disabled. Enable only after the UI is ready.

Other settings, on the Bot page under Controls → Attention: loopDailyBudget (5),
loopQuietStart (22), loopQuietEnd (7). The time zone is this Mac's
(`STUDIO_LOOP_TIME_ZONE` overrides it). Budget is server-side and shared by all
release paths.

Mobile notify remains backward compatible. Optional category BB_LOOP, loopId and
actions are carried in notification data. APNs selects category BB_LOOP. Action
IDs use the loops.act vocabulary; the iOS worker registers the category and sends
taps to Studio. The push also carries `loopKind` and, for a decision, up to
four `options`, with `mutable-content`, so the app's notification extension
picks per-kind buttons (Done or Got it, Snooze until tonight, Snooze until I'm
home, and one button per option). Payloads retain the Bot thread and personal project for routing.

Delivery is at-least-once across a crash between an external send and its history
write. There is no distributed transaction with BB or APNs. A successful relay
call with zero registered devices is recorded, avoiding repeated futile pushes.

## Desktop UI

Studio registers two directives (`src/loops/ui`). Coming up shows who will do a
loop that isn't Patrick's ("Chief of Staff will do it"), and a held loop's chip
says "Next free slot" or "Tomorrow morning card" instead of "Anytime". A thread
owner shows by its title; Open thread shows only while the thread exists, and a
CoS loop opens the Bot's chat. Needs you now lists the same items as the Bot
row's badge: released loops, pending Bot questions and unread Bot replies. `::loop{id}` is the card:
do (Done, Snooze, Hand off, Drop), decide (up to three options inline, else
Choose…, plus Snooze), read (Got it) and waiting (Nudge them, Drop). Nudge
asks the Bot for a draft to approve in the chat; it never sends. A loop owned
by `cos` or a lead shows "<owner> is on it" with Open thread and Take it back
(`loops.update` owner patrick, status surfaced). A closed loop collapses to a
line with Undo (`loops.update` status surfaced). A loop with no update in three
days adds Keep and Drop for the weekly review. `row="1"` is the morning row and
`::loops{more}` the link to the Loops list. `::loops{open="pane"}` is a card
with "Open Loops beside the chat"; the Bot posts it when Patrick wants to go
through his loops (the loops_list tool says so). Leave a blank line before each bold
section label: without one, Markdown runs the label into the list above it.

The Bot page has Info | Loops at `bot/<botId>/loops` for the primary Bot, and
the sidebar has an All loops row under it.

The Loops pane (`src/loops/ui/LoopsPane.tsx`) is the same list in the thread's
side panel, a thread tab (`experimental_tab`) with id `loops`, so it stays up beside the
Bot's chat. It has the tab's sections, area chips, Owner and Add a loop; each
row is a title, one line of detail and a ⋯ menu with the row's actions (Done,
Snooze, Hand off, a decision's options, Got it, Surface now, Take it back,
Open thread, Nudge them, Change trigger…, Drop) after Discuss, and Done rows
keep Undo. Open rows drag into the composer as their `::loop` line.
Change trigger opens under its row, with Send to iPhone. On Patrick's do and read
loops the kind circle is the Done checkbox (a check on hover, Mark done;
read closes as Got it): one click closes it, and the row stays in place, done
with Undo, until the pane closes. Decide and waiting rows keep their icon. Its header opens the
full Loops tab. It opens from:

- the Loops button in the Bot chat's header (a thread action with
  `placement: "header"`, only on the primary Bot's chat), labelled with what
  needs Patrick now ("Loops · 2");
- `::loops{open="pane"}` and `::loops{more}` in the chat
  (`experimental_useAppPanel().openTab`; where there is no side panel they
  open the Loops tab);
- All loops in the sidebar, which opens the Bot's chat with the pane beside it.
  The sidebar isn't in the thread view, so it asks the chat
  (`requestThreadTab`, `src/kit/app/thread-panel.tsx`): the chat's composer
  opens the tab once and answers whether it opened. No retries; when it
  didn't open, a toast says so and offers the Loops page;
- the Bot row: opening the chat opens Loops beside it instead of Bot info
  while the badge counts something, since Needs you now lists the same items;
- the side panel's launcher (Loops), on any thread. Every saved loop change publishes
Studio's realtime signal, so cards, the tab and badges refetch. With
`loopsEnabled` off there's no tab or row, and cards are one quiet line (one per
morning message).
