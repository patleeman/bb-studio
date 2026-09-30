# BB Studio

A personal native iOS and watchOS app for BB and
[BB Studio](https://github.com/patleeman/bb-studio): BB's threads, approvals,
terminals and automations, plus the Studio suite of plugins (Studio, Pages,
Talk, Draw, Artifacts, Tasks, Teams and Chat). Everything else opens the BB web
app in an in-app web view (the Web tab, and the safari button on every thread).

Studio features need the matching plugins from the bb-studio marketplace on the
server. The app uses only those and the plugins that ship with BB, plus its own
push relay, the [Studio Mobile](../../packages/bb-studio-mobile/) plugin (`mobile`). The app was called BB Go; its bundle IDs and app group
are unchanged, and old `bbgo://` links still open.

| Feature | Where |
|---|---|
| Home: the BB web sidebar on the phone. Channels, direct messages (current bots, unarchived threads), Pinned, your project groups in the sidebar's order, then Threads. Running threads first, then most recent activity; child threads nest under their parent; sections collapse | `iOS/Inbox/InboxView.swift` |
| Swipe and context-menu actions: archive, delete (with confirmation), pin, read/unread, rename (threads, channels and DMs) | `iOS/Inbox/InboxView.swift` |
| Search across thread titles and messages, active and archived | `iOS/Inbox/InboxView.swift` |
| New thread with project, provider, model, reasoning, and permissions (the choice becomes the project default, as in the web app) | `iOS/Inbox/NewThreadView.swift` |
| Thread view with live updates, send, and stop. Opens at the newest message and follows new output only while you're at the bottom; a jump button brings you back. Older pages load as you reach the top, without moving what you're reading. File paths in messages (inline code like `docs/plan.md:12`, or Markdown file links) open in the file viewer, including absolute paths outside the workspace like `/tmp/shot.png`, read from the thread's host. The ⋯ menu has Voice chat, Find in thread, Rename, Model & permissions, Mute notifications, Open in BB web, Share link, and Copy Thread ID (also on a thread row's long-press) | `iOS/Thread/ThreadView.swift` |
| Live updates fetch only what changed: new rows since the last sequence, and the thread or its approvals only when those changed | `iOS/Thread/ThreadModel.swift` |
| A red "New" line where you left off; the thread opens there when there's something unread | `iOS/Thread/ThreadView.swift` |
| Find in thread: searches every message, with a match count and up/down to step through them | `iOS/Thread/FindBar.swift` |
| Drafts are kept per thread, and Home marks threads that have one | `iOS/Thread/Drafts.swift` |
| `@` suggests threads, bots, channels, DMs, and recordings, and sends them as real BB mentions | `iOS/Thread/MentionSuggestions.swift`, `Shared/Mentions.swift` |
| The composer grows with the message, then offers a full-screen editor | `iOS/Thread/ThreadView.swift` |
| Change a thread's model, reasoning level, and permissions (Accept edits, Auto, Full access, up to the machine's ceiling) for its next turns. BB takes permissions with each message, so the choice goes out with the next one you send. Until then a card over the composer shows it, with Undo | `iOS/Thread/ExecutionSheet.swift` |
| File edits show `+N −M` and open to a red/green diff | `iOS/Thread/DiffView.swift` |
| Messages written while BB is unreachable wait in an outbox and send, in order, when it's back. Failures that may have reached BB wait for Try again, so nothing sends twice | `iOS/Thread/Outbox.swift` |
| Mute a thread's notifications (for all BB Studio devices, through the relay). Notifications group by thread | `iOS/Thread/MutedThreads.swift`, `packages/bb-studio-mobile/server.ts` |
| Read BB Pages (in Studio): each page's text, tables, callouts, stats, charts, and embeds. Embedded drawings, artifacts, recordings, tasks and other Studio items show as cards and open natively. Work with this page (a bar at the bottom starts a thread that knows the page, or hands it to an @mentioned bot), the page's past chats, rename, archive, and version history with save and restore. Comments (the toolbar button shows how many are open): read threads with the text they're on, reply, resolve or reopen, show resolved ones, and start a thread on any block; an @bot in a comment reaches that bot. A thread started from a page links back to it | `iOS/Pages/` |
| Automations: every schedule by project, next and last run, recent runs with output or their thread, run now, pause and resume | `iOS/Tools/AutomationsView.swift` |
| Queue: every unsent message across threads, including drafts, scheduled sends, automatic retries, and waits on a busy thread, offline host or plugin (with Smart Queue's reason). Send now, edit or cancel | `iOS/Tools/QueueView.swift` |
| Drafts: long-press Send, then Save as Draft to park a message on the thread until you send it | `Shared/PluginExtras.swift` |
| Attention: what bots flagged across channels (decisions, blockers, updates). Open, Snoozed and Done; swipe to mark done or snooze, or open the channel. Home shows open attention and approval counts per channel | `iOS/Tools/AttentionView.swift` |
| Channel approvals: bots' pending tool approvals and questions show in their channel and are answered there | `iOS/Inbox/ChannelView.swift` |
| Channel automations: ⋯ → Automations in a channel lists its scheduled bot prompts. Create or edit one (bot, task, Weekdays/Every day/Every hour/Once/custom cron, timezone), pause or resume, run now, delete, and browse runs with links to the response threads | `Shared/ChannelAutomations.swift`, `iOS/Inbox/ChannelAutomationsView.swift` |
| Plan reviews: when an agent asks for a Plannotator review, a card opens the review UI; cancel from its menu | `iOS/Thread/PlanReviewSheet.swift` |
| Custom instructions: edit the text BB adds to every agent's system prompt (Settings → Agents) | `iOS/App/CustomInstructionsView.swift` |
| Usage: each pooled Claude and Codex account's 5-hour and weekly limits, with reset times | `iOS/Tools/UsageView.swift` |
| Send later: long-press Send for 30 minutes, 1 hour, 3 hours, tomorrow at 9, or a picked time | `iOS/Thread/SendLater.swift` |
| Side chat: ask about one message in a hidden fork without derailing the thread | `MessageBubble` |
| Host settings: keep the Mac awake, and how many threads run at once | `iOS/Tools/ServerControls.swift` |
| Files & changes: a thread's uncommitted changes with diffs, a file browser, file search, and file previews (images, rendered Markdown, text) | `iOS/Thread/FilesView.swift` |
| Terminals: BB's persistent terminals, from a thread's ⋯ menu (its workspace) or Home → Terminals (any connected machine). A full VT terminal (SwiftTerm) with a key bar for Esc, Ctrl, Tab and arrows; new shell or run a command; rename, restart, close, paste, copy output, text size. Reconnects replay only missed output, and the shell keeps running when you leave | `iOS/Terminal/`, `Shared/Terminals.swift` |
| Edit the last message you sent, retry a failed turn, fork, compact, and resend a recent prompt | `ThreadView`, `iOS/Thread/PromptHistoryView.swift` |
| Archived threads: search, open, and unarchive | `iOS/Tools/ArchivedView.swift` |
| Drawings (in Studio): Excalidraw drawings rendered natively, with zoom, live updates while an agent draws, and share as an image, and rename | `iOS/Tools/DrawingsView.swift` |
| Markdown in replies and your own messages: headings, nested and task lists, quotes, tables, code blocks with Copy, images (`![alt](path)`: files on the thread's host, absolute or from the workspace root, as BB web loads them, or web URLs; tap for full screen), and `@thread` mentions that show the thread's title and open it. Long messages of yours fold at 15 lines with Show more, as in BB web | `iOS/Thread/Markdown.swift`, `iOS/Thread/MarkdownImage.swift`, `iOS/Thread/Messages.swift` |
| Image attachments in a thread show three to a row; tap one to view it full size | `iOS/Thread/Messages.swift` |
| Emoji reactions from `::reactions{items="…"}`: tapping a chip drafts the reply (it doesn't send), as in BB web. Long-press any reply for Agree, Disagree, Do it, and Clarify | `iOS/Thread/Messages.swift` |
| Long-press a message: when it was sent, Copy, Select Text, Quote, Share. Long-press an edit or file read in the steps for Open File and Copy Path, or a command for Copy Command | `iOS/Thread/Messages.swift` |
| Tool activity collapses into one row per run ("3 commands, 2 edits"). Tap for each step and its output | `iOS/Thread/Messages.swift` |
| Edit a queued message or draft before it sends. Attachments stay, @-mentions stay while their text does, and the edit is refused if the message sent or changed meanwhile | `iOS/Tools/QueuedMessageEditor.swift`, `BBClient.editQueued` |
| The shelf above the composer: model fallback, plan mode (exit), goal (clear), background work, todo progress, and queued messages (tap to edit, send now, remove). Two or more queued messages fold into one "N queued" row; expanded, hold and drag to reorder, or use Move to Top / Up / Down | `iOS/Thread/ThreadShelf.swift` |
| Paste text or images into the composer. Images become attachments | `iOS/Thread/Composer.swift` |
| Answer approvals (command, file, permission, plan) and questions in the thread, including the ask-user-question plugin's multi-question forms and secret requests (values go straight to the server and aren't kept). Other plugin forms open the web app | `iOS/Thread/InteractionCard.swift`, `Shared/Interactions.swift` |
| Attachments from photos, the camera, or files (JPEG re-encoded, 35 MB limit) | `iOS/Thread/Attachments.swift` |
| Offline cache: the inbox and recent thread messages show before the network answers | `DiskCache`, `ThreadModel` |
| Connection banner when BB is unreachable (usually Tailscale off), with Open Tailscale and Retry | `ConnectionBanner` |
| Actionable notifications: Approve, Deny, Approve plan, Answer, and Reply from the lock screen. Multiple-choice questions get a button per option | `iOS/App/NotificationActions.swift`, `NotificationService/`, `packages/bb-studio-mobile/apns.ts` |
| Studio tab: pages, recordings, dictations, drawings, and artifacts in one list, grouped by day, with kind and project filters, an Archived filter, search (titles plus the Studio plugin's content search, with the matching text shown in bold under the row), thumbnails for drawings and image artifacts, and swipe to delete or archive. Long-press for New Thread with This, each add-on's own actions (Copy Transcript, Copy as Markdown, Copy Text), Move to Project, and Archive or Restore. Capture tiles at the top: Dictate (long-press for Dictate a Page or Record), Write (a blank note, with a mic, that saves as a page, a task or a thread and keeps its draft if you close it; long-press for New Page, Drawing and the rest), Task (add tasks one after another, with due Today or Tomorrow and For an agent; long-press for the board), and Record. New (+) makes any kind Studio can create, like a page or a drawing, in the filtered project. Studio tags: colored tags on rows, tag filter chips, and Tags (toggle, New Tag…) on long-press, shown when the Studio plugin supports them; long-press a tag chip to rename or delete the tag. Select (also on search results) picks several items to archive or restore, move, tag, delete, or run an add-on's action on together. Uses the Studio plugin's overview when it's installed, or asks Pages, Talk, and Excalidraw directly | `iOS/Studio/StudioView.swift` |
| Tasks (in Studio, with the Studio Tasks plugin): the board as To do, In progress, Review and Done columns with counts, swipe to move a task on or archive it, long-press to move it anywhere, and archived tasks on request. A task shows its description, due day, who it's for and its project; change status, edit, share, archive or delete. Hand it to an agent (project, provider, model and reasoning or the project's defaults, worktree or folder, a note). Link pages, drawings, artifacts, recordings and threads to it (Add Link…), or swipe a link away, follow its handoffs to their threads, send back review feedback, and archive its threads when it's done. `::task{…}` cards in replies open it, and the board updates live | `Shared/Tasks.swift`, `iOS/Studio/TasksView.swift` |
| Studio Chat (with the Studio Chat plugin): Chat About This on a drawing, artifact, recording or task starts a thread with the project's default agent that knows the item, or continues the item's last chat | `Shared/StudioChat.swift`, `iOS/Studio/StudioChatSheet.swift` |
| Bots in Studio: Bot Teams bots are a Studio kind with model and Working/Error badges; archive retires. A bot opens to its description, direct messages and channels (`bbstudio://bot/<id>`) | `iOS/Inbox/BotView.swift` |
| Artifacts (in Studio): files agents save from threads. Markdown rendered (or as source), code and text in monospace, images zoomable, HTML and PDF in a sandboxed web view. Versions, share the file, copy text, New Thread with This, Save as Page, open the source thread, rename, move, delete. `::artifact{…}` cards in replies and Studio links in messages open natively. `::inline-vis{…}` previews in replies (BB's built-in inline-vis plugin): HTML visualizations from the workspace or thread storage run in a sandboxed web view at the reply's height, Markdown files render natively, with collapse, full screen, and the web app's errors for a missing file or bad height. Save Files to Studio (from the thread menu or a reply's long-press) lists the files a reply made plus the thread's storage, and saves the chosen ones as artifacts or new versions | `iOS/Studio/ArtifactView.swift`, `iOS/Studio/SaveToStudioSheet.swift`, `iOS/Thread/InlineVis.swift` |
| Dictation and recordings through the Talk plugin, with an offline segment outbox. A standalone dictation can be saved as a page, and recordings open to their transcript with share, copy, new thread, rename, retry of failed transcription, and delete | `iOS/Talk` |
| Hands-free voice chat with one thread (on-device STT, then the thread, then TTS). You can talk over it, and pick the voice and speed in Settings. Uses the iPhone mic even with Bluetooth audio, restarts after calls and route changes, warns when the mic sends only silence, and links to Settings when a permission is off | `iOS/Voice` |
| Action button and Siri shortcuts: Dictate, Voice chat, Open thread, New thread, Write, New task, "Ask BB" (Siri waits for the reply and reads it). Home Screen quick actions (long-press the icon): Dictate, Write, New Task, New Thread; `bbstudio://write` and `bbstudio://new-task` open the same sheets | `iOS/App/Intents.swift`, `iOS/App/BBStudioApp.swift` |
| Control Center and lock screen controls: Dictate, Voice chat, New thread | `Widgets/Controls.swift` |
| The BB Studio theme's coral accent (#c7431a light, #ff7a45 dark, from the Silk S icon) on buttons, chips, your messages and unread dots, across the app, widgets, share sheet and watch. The BB Web tab follows the server's theme | `*/Assets.xcassets/AccentColor.colorset`, `project.yml` |
| Home and lock screen status widgets | `Widgets/StatusWidget.swift` |
| Spotlight indexes open threads. Handoff opens the current thread in the Mac browser | `iOS/App/Spotlight.swift` |
| Share extension: send text, links, images, and files to a new or existing thread | `Share/` |
| URL scheme `bbstudio://thread/<id>`, `page/<id>`, `automations`, `queue`, `usage`, `archived`, `attention`, `studio` (also `talk`, `pages`, `drawings`), `drawing/<id>`, `artifact/<id>`, `terminals`, `new`, `dictate`, `voice[/<id>]`, `web`, `settings`. Links with the old `bbgo://` scheme still open | `AppModel.handle` |
| One status Live Activity: how many threads need you and how many are running, in the Dynamic Island and on the lock screen | `Widgets/`, `iOS/App/LiveStatus.swift`, `packages/bb-studio-mobile/live.ts` |
| iPad: sidebar tabs, a split view with the inbox beside the thread, a Find button, and a readable width for messages. A Thread menu in the menu bar. Keyboard: ⌘↩ send, ⌘N new thread, ⌘↓ latest, ⇧⌘M model, ⌘. stop; in find, ⌘G / ⇧⌘G step | `iOS/App/RootView.swift` |
| Haptics for sends, answers, errors, and swipe actions | |
| Watch app: inbox, last messages, dictated or quick replies, and answering approvals and questions (relayed through the phone) | `Watch/` |
| Watch complication: needs-you and running counts | `WatchWidgets/` |
| APNs push relay for BB's push-notifications plugin, with notification categories | `packages/bb-studio-mobile/` |

## Connection

The app talks to `https://patricks-megamac.tail5a01ec.ts.net`, which
`tailscale serve` proxies to BB on `127.0.0.1:38886`. BB has no client auth,
so the tailnet is the boundary. You can change the server in Settings.

## Build

```sh
brew install xcodegen
xcodegen generate
open BBStudio.xcodeproj   # run the BBStudio scheme on your iPhone; the watch app is embedded
```

To install on your paired iPhone without TestFlight (a Debug build that
replaces the TestFlight one):

```sh
scripts/device.sh
```

Headless simulator runs: `-skipPushPrompt YES -openURL bbstudio://thread/<id>`.
`-qaShelfDemo` (Debug builds) fills every thread's shelf with sample cards.

UI tests click through Home and a thread (reaction chips, paste, the message
menu, quoting, and jump-to-latest) against the BB server the simulator is
signed in to. Point them at a throwaway thread whose newest reply ends with a
`::reactions` line:

```sh
TEST_RUNNER_BBGO_QA_THREAD=thr_xxx xcodebuild test -scheme BBStudio \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro' -only-testing:BBStudioUITests
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
   cd ../../packages/bb-studio-mobile && npm install && bb plugin build && bb plugin install .
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
   Upload only when Patrick asks for a build: batch changes into one upload,
   not one per commit. Apple caps uploads per day, and each build means a new
   install. To try a change on the phone meanwhile, use the Debug install above.
   Internal testers (you) get builds without App Review. TestFlight builds use
   production APNs, so the APNs key must be enabled for **Sandbox & Production**.
