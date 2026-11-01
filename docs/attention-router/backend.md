# Attention Router backend

The store lives in Studio SQLite. The appended migration adds `bot_loops`
(records validated by the shared Zod schema), `loop_events` (append-only history),
and durable scheduler bookkeeping. All timestamps are Unix milliseconds.
The phone keeps saved places and coordinates. Studio receives only place names
and arrive/leave events; it never stores location history.

## RPC and tools

The public Studio contract exports these method names verbatim, including dots:

- `loops.list({area?,owner?})`: needsYouNow, comingUp, agentsOnIt,
  waitingOnOthers and done (closed in the past seven days).
- `loops.get({id})`: loop and chronological history.
- `loops.add({text})`: create a draft owned by cos, then send the Bot an
  agent-only message through `threads.send` to interpret it with loops_update.
  The server makes no LLM calls. An active Bot chat is required for delivery.
- `loops.update({id,changes?,surfaceNow?})`: update fields; surfaceNow queues
  immediate release through the same budget and quiet-hour policy.
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

Agent tools: loops_add accepts structured fields; loops_list, loops_update,
loops_act, loops_fire and loops_morning mirror the APIs above. These are included
in Studio's agent configuration. Capture tools should avoid duplicating pending
Bot questions; a source `{kind: 'interaction', ref: '<interaction id>'}` also lets
the badge deduplicate an explicitly tracked interaction.

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
Time and none triggers release when eligible. Only Patrick-owned loops release;
low priority waits for the morning list. The daily cap counts surfaced history
in the configured zone. Urgent bypasses quiet hours and budget. Surface now uses
this same policy. A successful Bot request records surfaced; failed requests retry.
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

Settings: `loopsEnabled` (label **Attention Router**, default **OFF**) gates all
scheduled releases, cards, stale messages, pushes and loop badge counts. Tools and
RPC remain usable for testing while disabled. Enable only after the UI is ready.

Other settings: loopTimeZone (America/New_York), loopDailyBudget (5), loopQuietStart
(22), loopQuietEnd (7). Budget is server-side and shared by all release paths.

Mobile notify remains backward compatible. Optional category BB_LOOP, loopId and
actions are carried in notification data. APNs selects category BB_LOOP. Action
IDs use the loops.act vocabulary; the iOS worker registers the category and sends
taps to Studio. Payloads retain the Bot thread and personal project for routing.

Delivery is at-least-once across a crash between an external send and its history
write. There is no distributed transaction with BB or APNs. A successful relay
call with zero registered devices is recorded, avoiding repeated futile pushes.
