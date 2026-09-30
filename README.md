# BB Go

A personal native iOS and watchOS client for BB. The native parts cover
what matters on the go. Everything else opens the BB web app in an in-app web
view (the Web tab, and the safari button on every thread).

| Feature | Where |
|---|---|
| Home: the BB web sidebar on the phone. Channels, direct messages (current bots, unarchived threads), Pinned, your project groups in the sidebar's order, then Threads. Running threads first, then most recent activity; child threads nest under their parent; sections collapse | `iOS/Inbox/InboxView.swift` |
| Swipe and context-menu actions: archive, delete (with confirmation), pin, read/unread, rename | `iOS/Inbox/InboxView.swift` |
| Search across thread titles and messages, active and archived | `iOS/Inbox/InboxView.swift` |
| New thread with project, provider, model, reasoning, and permissions (the choice becomes the project default, as in the web app) | `iOS/Inbox/NewThreadView.swift` |
| Thread view with live updates, send, and stop. Opens at the newest message and follows new output only while you're at the bottom; a jump button brings you back. Older pages load as you reach the top, without moving what you're reading. The ⋯ menu has Voice chat, Open in BB web, and Share link | `iOS/Thread/ThreadView.swift` |
| Markdown in replies and your own messages: headings, nested and task lists, quotes, tables, code blocks with Copy, and `@thread` mentions that show the thread's title and open it. Long messages of yours fold at 15 lines with Show more, as in BB web | `iOS/Thread/Markdown.swift`, `iOS/Thread/Messages.swift` |
| Image attachments in a thread show three to a row; tap one to view it full size | `iOS/Thread/Messages.swift` |
| Emoji reactions from `::reactions{items="…"}`: tapping a chip drafts the reply (it doesn't send), as in BB web. Long-press any reply for Agree, Disagree, Do it, and Clarify | `iOS/Thread/Messages.swift` |
| Long-press a message: Copy, Select Text, Quote, Share | `iOS/Thread/Messages.swift` |
| Tool activity collapses into one row per run ("3 commands, 2 edits"). Tap for each step and its output | `iOS/Thread/Messages.swift` |
| The shelf above the composer: model fallback, plan mode (exit), goal (clear), background work, todo progress, and queued messages (send now, remove) | `iOS/Thread/ThreadShelf.swift` |
| Paste text or images into the composer. Images become attachments | `iOS/Thread/Composer.swift` |
| Answer approvals (command, file, permission, plan) and questions in the thread. Plugin forms open the web app | `iOS/Thread/InteractionCard.swift`, `Shared/Interactions.swift` |
| Attachments from photos, the camera, or files (JPEG re-encoded, 35 MB limit) | `iOS/Thread/Attachments.swift` |
| Offline cache: the inbox and recent thread messages show before the network answers | `DiskCache`, `ThreadModel` |
| Connection banner when BB is unreachable (usually Tailscale off), with Open Tailscale and Retry | `ConnectionBanner` |
| Actionable notifications: Approve, Deny, Approve plan, Answer, and Reply from the lock screen. Multiple-choice questions get a button per option | `iOS/App/NotificationActions.swift`, `NotificationService/`, `plugin/apns.ts` |
| Dictation and recordings through the Talk plugin, with an offline segment outbox | `iOS/Talk` |
| Hands-free voice chat with one thread (on-device STT, then the thread, then TTS). You can talk over it, and pick the voice and speed in Settings | `iOS/Voice` |
| Action button and Siri shortcuts: Dictate, Voice chat, Open thread, New thread, "Ask BB" (Siri waits for the reply and reads it) | `iOS/App/Intents.swift` |
| Control Center and lock screen controls: Dictate, Voice chat, New thread | `Widgets/Controls.swift` |
| Home and lock screen status widgets | `Widgets/StatusWidget.swift` |
| Spotlight indexes open threads. Handoff opens the current thread in the Mac browser | `iOS/App/Spotlight.swift` |
| Share extension: send text, links, images, and files to a new or existing thread | `Share/` |
| URL scheme `bbgo://thread/<id>`, `new`, `dictate`, `voice[/<id>]`, `talk`, `web`, `settings` | `AppModel.handle` |
| One status Live Activity: how many threads need you and how many are running, in the Dynamic Island and on the lock screen | `Widgets/`, `iOS/App/LiveStatus.swift`, `plugin/live.ts` |
| iPad: sidebar tabs, and a split view with the inbox beside the thread | `iOS/App/RootView.swift` |
| Haptics for sends, answers, errors, and swipe actions | |
| Watch app: inbox, last messages, dictated or quick replies, and answering approvals and questions (relayed through the phone) | `Watch/` |
| Watch complication: needs-you and running counts | `WatchWidgets/` |
| APNs push relay for BB's push-notifications plugin, with notification categories | `plugin/` |

## Connection

The app talks to `https://patricks-megamac.tail5a01ec.ts.net`, which
`tailscale serve` proxies to BB on `127.0.0.1:38886`. BB has no client auth,
so the tailnet is the boundary. You can change the server in Settings.

## Build

```sh
brew install xcodegen
xcodegen generate
open BBGo.xcodeproj   # run the BBGo scheme on your iPhone; the watch app is embedded
```

To install on your paired iPhone without TestFlight (a Debug build that
replaces the TestFlight one):

```sh
scripts/device.sh
```

Headless simulator runs: `-skipPushPrompt YES -openURL bbgo://thread/<id>`.
`-qaShelfDemo` (Debug builds) fills every thread's shelf with sample cards.

UI tests click through Home and a thread (reaction chips, paste, the message
menu, quoting, and jump-to-latest) against the BB server the simulator is
signed in to. Point them at a throwaway thread whose newest reply ends with a
`::reactions` line:

```sh
TEST_RUNNER_BBGO_QA_THREAD=thr_xxx xcodebuild test -scheme BBGo \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro' -only-testing:BBGoUITests
```

`testProbe` screenshots any thread while scrolling up through it, without
changing anything: `TEST_RUNNER_BBGO_PROBE_THREAD=thr_xxx`, plus optionally
`TEST_RUNNER_BBGO_PROBE_SWIPES=<n>`, `TEST_RUNNER_BBGO_PROBE_FAST=1`, and
`TEST_RUNNER_BBGO_PROBE_FIND=<text>` to stop once that text is on screen.
Screenshots land in `/tmp/qa-ui-probe-*.png`.

On Apple silicon the simulator receives real (sandbox) pushes once you allow
notifications, including through the notification extension.

## Still to do (needs Apple credentials)

1. **Device install**: open the project in Xcode once, and let automatic
   signing (team 3753DAN98U) register these bundle IDs:
   - `nyc.plee.bbgo` (with Push Notifications).
   - `nyc.plee.bbgo.share`.
   - `nyc.plee.bbgo.notifications`.
   - `nyc.plee.bbgo.widgets`.
   - `nyc.plee.bbgo.watchkitapp`.
   - `nyc.plee.bbgo.watchkitapp.widgets`.

   All of them share the app group `group.nyc.plee.bbgo`. The widgets, the
   share extension, and the complication read the server URL and status from
   it.
2. **APNs key**: create an APNs auth key for **Sandbox & Production** (Certificates, IDs & Profiles →
   Keys). Then:
   ```sh
   cd plugin && npm install && bb plugin build && bb plugin install .
   bb plugin config mobile set apnsKeyPath ~/path/to/AuthKey_XXXXXXXXXX.p8
   bb plugin config mobile set apnsKeyId XXXXXXXXXX
   bb mobile status
   ```
3. **Route BB pushes through the relay**. This changes the push-notifications
   plugin, and non-APNs tokens still reach Expo:
   ```sh
   bb plugin config push-notifications set expoPushUrl \
     "http://127.0.0.1:38886/api/v1/plugins/mobile/http/push?token=$(bb plugin token mobile)"
   ```
   The app registers itself (`apns:<token>`) on its first launch after you
   grant notification permission. It also registers its Live Activity tokens,
   so the plugin can start the status activity while the app is closed. Until
   then, the app keeps the activity current only while it is open.
4. **TestFlight** (optional):
   1. Sign in to Xcode with the team's Apple ID (Settings → Accounts). The
      script signs and uploads through that account. An App Store Connect API
      key can't manage App Groups, so it can't sign this app.
   2. Create the app in App Store Connect with bundle ID `nyc.plee.bbgo`. The
      bundle ID appears in the list after the first signed archive
      (`scripts/testflight.sh --archive-only`).
   3. Run:
      ```sh
      scripts/testflight.sh                 # archive, sign, upload
      scripts/testflight.sh --archive-only  # signed archive, no upload
      scripts/testflight.sh --dry-run       # unsigned Release archive
      ```
   The build number is the UTC time, so each upload is newer than the last.
   Internal testers (you) get builds without App Review. TestFlight builds use
   production APNs, so the APNs key must be enabled for **Sandbox & Production**.
