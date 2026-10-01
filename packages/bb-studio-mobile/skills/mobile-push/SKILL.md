---
name: mobile-push
description: Check or configure the BB Studio push relay (the Mobile plugin) that sends BB push notifications to the native iOS app over APNs.
---

# BB Studio push relay

The Mobile plugin receives the push-notifications plugin's Expo-format batches
at `POST /api/v1/plugins/mobile/http/push` (token auth). Tokens starting with
`apns:` go to Apple; every other token is forwarded to Expo unchanged, so the
official mobile app keeps working.

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

- `bb mobile status [--json]` — whether APNs is configured, and the last delivery result.

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
