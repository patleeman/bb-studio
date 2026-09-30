# bb-plugin-mobile

Server side of BB Go. It relays BB push notifications to the native iOS app
over APNs, and drives the app's status Live Activity. See `skills/mobile-push/SKILL.md` for settings and wiring.

```sh
npm install
npm test
bb plugin build
bb plugin install .
```
