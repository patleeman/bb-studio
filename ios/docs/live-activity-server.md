# Bot Live Activity: what Studio must send

The phone shows one Live Activity per Bot (plan section 4, design 10e) only
while a turn the user started from the phone runs or asks them something.
Push notifications are the one way to say something needs the user or
finished; the activity is not. Workers alone never start or keep one, and
there is no always-on "N workers" card. While the app is open the phone starts,
updates and ends the activity itself. While the app is closed only Studio can
update or end it, through the Mobile relay's `live_activity_push`. That Studio
side does not exist yet. This is what it needs to do.

The phone side is done: `LiveActivity/BotActivityAttributes.swift` (the
types below and the rules), `Shared/PhoneTurns.swift` (the turns sent from the
phone), `iOS/App/BotLiveActivities.swift` (local updates and token
registration) and `Widgets/BotLiveActivity.swift` (the views).

## The phone's rules

- `BBClient.send` (not a scheduled send), a new conversation and a question
  about a worker record the thread and the time in `PhoneTurns`. Entries go
  after 30 minutes, or once the turn is seen finished.
- The activity shows for such a turn while its conversation is running or
  needs the user. A turn sent less than 20 seconds ago counts as running until
  BB says it runs, unless it was already seen running.
- It shows status only: `line` is left out, `workers` is 0, `state` is
  `thinking` or `needs`. Never an old reply, never a `[PASS]`.
- When the turn finishes it ends at once (`dismissalPolicy: .immediate`): the
  reply's push says it's done.

## Tokens (done on the phone)

At every launch, the app registers with `mobile.live_activity_register`:

- its push-to-start token for every Bot in `bot_spaces`
  (`kind: "push-to-start"`; Studio must not use it to start an activity);
- each running activity's update token (`kind: "update"`), for activities the
  app started and ones Studio started by push.

`deviceId` is the phone's `identifierForVendor`. The relay picks the tokens
from the `botId`, so Studio never sees them.

## When to push

Studio never starts an activity: it can't tell a turn sent from the phone.
It only updates and ends one the phone started (it has the update token).
Open point: Studio needs that activity's conversation. Proposed: the phone
sends `conversationId` with the `update` token in `live_activity_register`.
Hook the `BotSignal` flush in `plugins/packages/bb-studio/src/bot-signal.ts`:
every `bot_threads_changed` event (`conversations` or `needs-you`) for a Bot
with an activity. For that Bot:

1. Work out the content state (below) from the same data as `bot_spaces` and
   `bot_threads_view`.
2. Compare it with the last state sent for that Bot (keep it in memory;
   ignore `updatedAt`). Send nothing when nothing shown changed.
3. Send:

| Before | Now | Event |
| --- | --- | --- |
| active | active, changed | `update` |
| active | finished | `end` |

"Active" means the activity's conversation (`conversationId`) is running
(`thinking`) or needs the user (`needs`). "Finished" means neither. Running
workers don't count.

Throttle updates to one every 5 seconds per Bot (APNs budgets Live Activity
updates). Never throttle `end`, or a change into or out of `needs`.

## Calls

All three go to `mobile.live_activity_push`
(`bb.sdk.plugins.callRpc({ pluginId: "mobile", method: "live_activity_push", … })`).
With no token registered the relay sends nothing and returns `{ sent: 0 }`, so
Studio can call it unconditionally. A failed call must not affect Studio.

Update:

```json
{ "event": "update", "botId": "bot_juniper", "contentState": { … }, "staleDate": 1794490069 }
```

Add `alert` to an update only when it moves into `needs` (it lights the
screen). Leave it out otherwise, so the relay sends at priority 5.

End:

```json
{ "event": "end", "botId": "bot_juniper", "contentState": { …last state, "state": "idle" }, "dismissalDate": 1794488400 }
```

`dismissalDate` now: the activity goes at once; the reply's push covers it.
`staleDate` now + 30 minutes greys out an activity Studio stopped updating.

`attributes.server` is how the phone scopes taps and buttons to a server. The
phone sets it when it starts the activity. An activity with an empty server
(from an older Studio push) counts as the selected server's
(`BotActivityAttributes.belongs(to:)`, the decision intent, and the tap link).

## Content state

The `contentState` JSON. Keys are exactly these; every key but `state`,
`workers` and `updatedAt` may be left out or null. Keep the whole payload
under 4 KB (the relay refuses larger ones). Keep the phone's shape: `workers`
0, no `line`, and keep `conversationId` as the phone set it.

| Key | Type | Value |
| --- | --- | --- |
| `state` | string | `thinking` or `needs` (`idle` and `working` still decode) |
| `workers` | int | 0 (the view shows a count only when it's above 0) |
| `conversationId` | string | the conversation of the phone's turn |
| `conversationTitle` | string | `"Main"` for Main, else the conversation's title |
| `line` | string | left out: the view shows "Main · Thinking…". If ever sent, plain text, at most 160 characters, never a `[PASS]` (the view hides one) |
| `needsYou` | string | only when `state` is `needs`: the conversation's `needsYou.reason`, else `"Approve: <summary>"` for a worker approval; at most 120 characters |
| `approval` | object | the first pending worker approval in that conversation (`bot_conversation_approvals`): `{ workerThreadId, interactionId, summary, canApprove, canDeny }`. `summary` is "<worker title>: <short or title>", at most 140 characters; `canApprove` is `decisions` contains `allow_once`, `canDeny` contains `deny` |
| `updatedAt` | number | Unix seconds |

Example (design 10e):

```json
{
  "state": "needs",
  "workers": 0,
  "conversationId": "thr_main",
  "conversationTitle": "Main",
  "needsYou": "Push bb-studio-native to origin?",
  "approval": {
    "workerThreadId": "thr_w1",
    "interactionId": "int_1",
    "summary": "Push: git push origin bb-studio-native",
    "canApprove": true,
    "canDeny": true
  },
  "updatedAt": 1794488269
}
```

`NativeSurfacesTests.testServerContentStateDecodes` decodes a state like this
one (with the older `line` and worker count too).

## What the phone does with it

- Lock screen: the presence still for `state`, the Bot's name, "Main ·
  Thinking…" (or the title alone while `needs`), and `needsYou` in amber
  (#f2b04a).
- Island compact: the presence still and a mark for the state (amber while
  `needs`). Minimal: the still.
- Island expanded: the same as the lock screen, plus Deny and Approve when
  `approval` is set. They call `bot_worker_approval_resolve`.
- A tap opens `bbstudio://conversation/<conversationId>` on that server.

## Not part of this

- Notifications: `notify`'s `botId`, `conversationId` and `needs-you` kind
  (plan section 4) are separate from this.
