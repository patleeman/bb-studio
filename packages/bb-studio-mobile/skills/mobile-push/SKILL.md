---
name: mobile-push
description: Check or configure the BB Studio push relay (the Mobile plugin) that sends BB push notifications to the native iOS app over APNs and drives its per-thread Live Activities.
---

# BB Studio push relay

The Mobile plugin receives the push-notifications plugin's Expo-format batches
at `POST /api/v1/plugins/mobile/http/push` (token auth). Tokens starting with
`apns:` go to Apple; every other token is forwarded to Expo unchanged, so the
official mobile app keeps working.

## Thread Live Activities

BB Studio shows a Live Activity for each top-level thread that is running,
needs you (a pending approval or question), failed unread, or finished in the
last 30 minutes and is still unread, up to three at once. Each shows the
thread's latest reply and what it's asking. Approve/Deny, single-select answer
choices, and Stop run from the lock screen; Reply opens the thread's composer.

The plugin starts each activity by push, updates it on thread events (text at
most every 30 seconds; phase and question changes at once, plus every two
minutes), alerts quietly when a thread newly needs you, fails, or finishes, and
ends it when the thread settles or is read. A swiped-away activity stays away
until its thread's phase changes. iOS caps an activity at eight hours, so the
plugin replaces it at 7.5.

The app reports its push-to-start and per-activity tokens through the
`live_register` RPC. Live Activity pushes use the same APNs settings below.

## Actionable notifications

Before delivering a `pending-interaction` push, the relay looks up the
thread's pending interactions. It adds `interactionId`, `interactionKind`,
`subjectKind`, and `decisions` to the push data, then sets `aps.category`:

| Category | When | Actions in the app |
|---|---|---|
| `BB_APPROVAL` | Approval that offers both `allow_once` and `deny` | Approve, Deny |
| `BB_PLAN` | Same, for a plan | Approve plan, Keep planning |
| `BB_CHOICE` | One single-select question with options | A button per option (up to 6), plus Other… when free text is allowed |
| `BB_QUESTION` | Any other ask-user question | Answer (text) |
| `BB_REPLY` | `turn-finished` or `thread-error` | Reply (text) |

For `BB_CHOICE`, the push also carries `choices` (option labels) and
`choiceFreeText`, and sets `mutable-content`. The app's notification service
extension registers a category with those buttons, because iOS only shows
actions from categories registered before the push arrives. If the extension
doesn't run, `BB_CHOICE` falls back to the Answer text box.

Other interactions (plugin forms) get no category and open the thread. The
app resolves the interaction through BB's API. If that fails, it posts a
local notification.

## Commands

- `bb mobile status [--json]` — whether APNs is configured, the last delivery result, and the Live Activity state.

## Settings (`bb plugin config mobile`)

| Setting | Meaning |
|---|---|
| `apnsKey` (secret) | Contents of the `AuthKey_XXXXXXXXXX.p8` key. Line breaks optional. |
| `apnsKeyPath` | Path to the `.p8` file, used when `apnsKey` is empty. |
| `apnsKeyId` | The 10-character key ID. |
| `apnsTeamId` | Apple team ID. Default `3753DAN98U`. |
| `bundleId` | App bundle ID. Default `nyc.plee.bbgo`. |
| `apnsEnvironment` | `auto` (production, then sandbox), `production`, or `development`. |
| `expoPushUrl` | Where non-APNs tokens go. Default Expo's push API. |

Settings are read on every delivery; no reload is needed.

## Wiring

Point push-notifications at the relay (the token is the per-plugin token
from `bb plugin token mobile`; never print it into chat or logs):

```sh
bb plugin config push-notifications set expoPushUrl \
  "http://127.0.0.1:38886/api/v1/plugins/mobile/http/push?token=$(bb plugin token mobile)"
```

Never read or print the APNs key.
