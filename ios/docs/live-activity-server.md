# Bot Live Activity: what Studio must send

The phone shows one Live Activity per Bot (plan section 4, design 10e) while
a turn or any worker runs, or while something needs Patrick. While the app is
open it starts, updates and ends the activity itself. While the app is closed
only Studio can, through the Mobile relay's `live_activity_push`. That Studio
side does not exist yet. This is what it needs to do.

The phone side is done: `LiveActivity/BotActivityAttributes.swift` (the
types below), `iOS/App/BotLiveActivities.swift` (local updates and token
registration) and `Widgets/BotLiveActivity.swift` (the views).

## Tokens (done on the phone)

At every launch, the app registers with `mobile.live_activity_register`:

- its push-to-start token for every Bot in `bot_spaces`
  (`kind: "push-to-start"`);
- each running activity's update token (`kind: "update"`), for activities the
  app started and ones Studio started by push.

`deviceId` is the phone's `identifierForVendor`. The relay picks the tokens
from the `botId`, so Studio never sees them.

## When to push

Hook the `BotSignal` flush in `plugins/packages/bb-studio/src/bot-signal.ts`:
every `bot_threads_changed` event (`conversations`, `workers`, `needs-you` or
`presence`) for a Bot. For that Bot:

1. Work out the content state (below) from the same data as `bot_spaces` and
   `bot_threads_view`.
2. Compare it with the last state sent for that Bot (keep it in memory;
   ignore `updatedAt`). Send nothing when nothing shown changed.
3. Send:

| Before | Now | Event |
| --- | --- | --- |
| idle or nothing sent | active | `start` |
| active | active, changed | `update` |
| active | idle | `end` |

"Active" means presence state `thinking`, `working` or `needs`, as
`BotSpace.presenceState` works it out on the phone: needs-you on the Bot, a
conversation or a worker → `needs`; else any running worker → `working`;
else a running turn in any conversation → `thinking`; else `idle`.

Throttle updates to one every 5 seconds per Bot (APNs budgets Live Activity
updates). Never throttle `start`, `end`, or a change into or out of `needs`.

On a Studio restart, nothing is remembered: send `start` for active Bots. The
phone ends a duplicate itself.

## Calls

All three go to `mobile.live_activity_push`
(`bb.sdk.plugins.callRpc({ pluginId: "mobile", method: "live_activity_push", … })`).
With no token registered the relay sends nothing and returns `{ sent: 0 }`, so
Studio can call it unconditionally. A failed call must not affect Studio.

Start:

```json
{
  "event": "start",
  "botId": "bot_juniper",
  "attributesType": "BotActivityAttributes",
  "attributes": { "botId": "bot_juniper", "botName": "Juniper", "server": "<mobile server identity namespace>" },
  "contentState": { … },
  "alert": { "title": "Juniper", "body": "Push bb-studio-native to origin?" },
  "staleDate": 1794490069
}
```

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

`dismissalDate` now + 60 s keeps the final state on the lock screen briefly.
`staleDate` now + 30 minutes greys out an activity Studio stopped updating.

`attributes.server` is how the phone scopes taps and buttons to a server. It
must equal `ServerScope.namespace(<server URL>)` on the phone: the SHA-256 hex of
the BB server URL the phone uses. Studio can't know that URL, so **the phone
should send it**. Proposed: add an optional `server` field to
`live_activity_register`, stored with the token, which the relay puts into
`attributes.server` on `start`. Until then, Studio sends `"server": ""`, and the
phone treats an empty server as the selected one (done:
`BotActivityAttributes.belongs(to:)`, the decision intent, and the tap link).

## Content state

The `contentState` JSON. Keys are exactly these; every key but `state`,
`workers` and `updatedAt` may be left out or null. Keep the whole payload
under 4 KB (the relay refuses larger ones).

| Key | Type | Value |
| --- | --- | --- |
| `state` | string | `idle`, `thinking`, `working` or `needs` |
| `workers` | int | running workers (`bot_threads_view` workers with status `running`) |
| `conversationId` | string | the conversation the line comes from (below) |
| `conversationTitle` | string | `"Main"` for Main, else the conversation's title |
| `line` | string | that conversation's `latest`, plain text (Markdown removed), at most 160 characters |
| `needsYou` | string | only when `state` is `needs`: the conversation's `needsYou.reason`, else `"Approve: <summary>"` for a worker approval, else `"<worker title> is waiting on you"`; at most 120 characters |
| `approval` | object | the first pending worker approval in that conversation (`bot_conversation_approvals`): `{ workerThreadId, interactionId, summary, canApprove, canDeny }`. `summary` is "<worker title>: <short or title>", at most 140 characters; `canApprove` is `decisions` contains `allow_once`, `canDeny` contains `deny` |
| `updatedAt` | number | Unix seconds |

Which conversation: the newest one with `needsYou`, else the newest running
one, else Main, else the newest.

Example (design 10e):

```json
{
  "state": "needs",
  "workers": 2,
  "conversationId": "thr_main",
  "conversationTitle": "Main",
  "line": "Fable moved the bridge onto the Studio contract.",
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

`NativeSurfacesTests.testServerContentStateDecodes` decodes this example.

## What the phone does with it

- Lock screen: the presence still for `state`, the Bot's name, "N workers",
  "conversationTitle · line", and `needsYou` in amber (#f2b04a).
- Island compact: the presence still and the worker count (amber while
  `needs`). Minimal: the still.
- Island expanded: the same as the lock screen, plus Deny and Approve when
  `approval` is set. They call `bot_worker_approval_resolve`.
- A tap opens `bbstudio://conversation/<conversationId>` on that server.

## Not part of this

- Notifications: `notify`'s `botId`, `conversationId` and `needs-you` kind
  (plan section 4) are separate from this.
