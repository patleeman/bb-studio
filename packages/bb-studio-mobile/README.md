# Studio Mobile

Part of BB Studio. The server side of the [BB Studio iOS app](../../apps/ios/):
it relays BB push notifications to the app over APNs, keeps muted threads in
sync across devices, and drives the app's status Live Activity. See
[`skills/mobile-push/SKILL.md`](skills/mobile-push/SKILL.md) for settings and
wiring.

Plugin ID: `mobile`.

```sh
npm install
npm test
bb plugin build
bb plugin install .
```

## Staged preview

![Studio Mobile settings in the running BB app](assets/staged-preview.png)

The live BB plugin settings show the APNs environment and Expo relay URL. No
private APNs key or device token is staged for the capture.
