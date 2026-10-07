# Studio Mobile

Part of BB Studio. The server side of the [BB Studio iOS app](../../apps/ios/README.md).
Plugin ID: `mobile`. It:

- relays BB's push notifications to the app over APNs (`apns:` tokens), and
  forwards every other token to Expo unchanged;
- lets other plugins notify the same phones through its `notify` RPC;
- keeps muted threads in sync across devices;
- tells the app to remove notifications for threads you have read, answered,
  archived, or deleted.

It needs BB 0.44 or newer and Plugin SDK 0.5.29 or newer. For wiring and
settings, see [`skills/mobile-push/SKILL.md`](skills/mobile-push/SKILL.md).

## Notifications

- **Plain alerts.** Finished turns and errors are alerts with no Reply field.
  Tap one to open the thread.
- **Actions.** Approval, plan, and question notifications keep lock-screen
  actions. The relay looks up the thread's pending interaction and adds it to
  the push. Actions target only that exact request.
- **Quiet completions.** A finished turn with no text, or only `[PASS]`, is not
  sent to APNs or Expo. The relay still reports success.
- **Muted threads.** A muted thread sends nothing to the app. Other
  subscribers still get it.
- **Collapse ids.** A `notify` call with `coalesceKey` sets `apns-collapse-id`,
  so pushes with the same key replace each other on the phone. Keys over 64
  bytes are hashed.
- **Payload size.** APNs rejects payloads over 4096 bytes, so the relay
  shortens a long body with an ellipsis.
- **Server identity.** Each push carries this relay's persistent server ID. The
  app checks it before opening, acting on, or clearing a notification. Update
  the relay along with the app; older notifications without an ID need manual
  review in the app.
- **Clearing.** Every minute, and shortly after a thread resumes, is archived,
  or is deleted, the relay checks the threads it notified about (for three
  days). Settled ones get a silent background push, and the app removes their
  notifications.
- **Devices.** The relay remembers each APNs device that received a push. It
  forgets a device after 30 days without one, and at once when Apple rejects its
  token for good. `notify` sends only to remembered devices, and its `sent`
  count includes only successful, unmuted deliveries.
- **Retries.** Notification tracking survives transient lookup or APNs
  failures, so the next check retries.

The relay can send a Live Activity push type, but nothing in the plugin starts
or updates Live Activities.

## CLI, RPC, and settings

- `bb mobile status [--json]` shows whether APNs is ready, the relay path, and
  the last delivery.
- RPC: `notify`, `mute_list`, `mute_set`.
- Settings (`bb plugin config mobile`): `apnsKey` (secret), `apnsKeyPath`,
  `apnsKeyId`, `apnsTeamId`, `bundleId`, `apnsEnvironment`, `expoPushUrl`. The
  skill file describes each one.
- No agent tools.

## Install and build

```sh
cd packages/bb-studio-mobile
npm install
npm test
bb plugin build .
bb plugin install .
```

## Staged preview

![Studio Mobile settings in the running BB app](assets/staged-preview.png)

The plugin's settings page in a staged BB (`node scripts/staged-bb.mjs start`) shows the APNs key, key ID, team,
bundle ID and environment fields and the Expo push URL. No private APNs key or
device token is staged for the capture.
