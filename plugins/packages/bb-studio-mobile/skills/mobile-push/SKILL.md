---
name: mobile-push
description: Check or configure the BB Studio push relay (the Mobile plugin) that sends BB push notifications to the native iOS app over APNs.
---

# BB Studio push relay

The Mobile plugin receives the push-notifications plugin's Expo-format batches
at `POST /api/v1/plugins/mobile/http/push` (token auth). Tokens starting with
`apns:` go to Apple; every other token is forwarded to Expo unchanged, so the
official mobile app keeps working.

Completion pushes with absent, empty, or whitespace-only text are suppressed
for APNs and Expo. So is a reply of only `[PASS]`, which older bot prompts
still send when they have nothing to add. The relay returns a successful ticket without sending an
alert. Attachment-only completions use a preview of the attachment. Questions,
errors, and useful completion replies still notify normally.

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
| `BB_REPLY` | `turn-finished` with a thread (a reply, the Bot's messages included) | Reply (text), sent to the thread |
| None | `thread-error`, or no thread | Tap to open the thread |

For `BB_CHOICE`, the push also carries `choices` (option labels) and
`choiceFreeText`, and sets `mutable-content`. The app's notification service
extension registers a category with those buttons, because iOS only shows
actions from categories registered before the push arrives. If the extension
doesn't run, `BB_CHOICE` falls back to the Answer text box.

Other interactions (plugin forms) get no category and open the thread. The
app resolves the interaction through BB's API. If that fails, it posts a
local notification.

## Clearing read notifications

The relay remembers which threads it notified the app about. Every minute,
and shortly after a thread resumes, is archived, or is deleted, it checks
them. A thread that is read with no open question, archived, or deleted gets a
silent background push (`clearThreadIds`), and the app removes that thread's
delivered notifications. Opening a thread in the app clears its notifications
directly. Threads are tracked for three days.

## Commands

- `bb mobile status [--json]` — whether APNs is configured, and the last delivery result.
- RPC `push_status` and `push_test` — the same status, and a test push to every remembered phone.
- `bb mobile live-activities [--json]` — the Live Activity tokens phones registered, by device, Bot and kind (`push-to-start` or `update`), without the tokens.

## Settings (`bb plugin config mobile`)

| Setting | Meaning |
|---|---|
| `apnsKey` (secret) | Contents of the `AuthKey_XXXXXXXXXX.p8` key. Line breaks optional. |
| `apnsKeyId` | The 10-character key ID. |

Settings are read on every delivery; no reload is needed. Push status and
**Send a test push** are in Studio's settings under Phone notifications
(Studio draws them; the `push_status` and `push_test` RPCs answer).

These were settings once and are constants now. Override one with an
environment variable on the BB host, then restart BB:

| Constant | Default | Variable |
|---|---|---|
| Apple team ID | `3753DAN98U` | `BB_MOBILE_APNS_TEAM_ID` |
| App bundle ID | `nyc.plee.bbgo` | `BB_MOBILE_BUNDLE_ID` |
| APNs environment | `auto` (production, then sandbox) | `BB_MOBILE_APNS_ENVIRONMENT` (`production` or `development`) |
| Expo push URL for non-APNs tokens | Expo's push API | `BB_MOBILE_EXPO_PUSH_URL` |

The key file path setting (`apnsKeyPath`) is gone: on the first load after
the change, a readable key file's contents moved into `apnsKey`. An
unreadable path is kept as a fallback until a key is pasted.

## Wiring

Point push-notifications at the relay (the token is the per-plugin token
from `bb plugin token mobile`; never print it into chat or logs):

```sh
bb plugin config push-notifications set expoPushUrl \
  "http://127.0.0.1:38886/api/v1/plugins/mobile/http/push?token=$(bb plugin token mobile)"
```

Never read or print the APNs key.
