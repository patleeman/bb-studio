# BB Studio

A personal native iOS and watchOS app for BB and
[BB Studio](https://github.com/patleeman/bb-studio): BB's threads, approvals,
terminals and automations, plus the Studio suite of plugins (Studio, Pages,
Talk, Draw, Artifacts, Tables and item Chat). Everything else opens the BB web
app in an in-app web view (the Web tab, and the safari button on every thread).

Studio features need the matching plugins from the bb-studio marketplace on the
server. The app uses only those and the plugins that ship with BB, plus its own
push relay, the [Studio Mobile](../../packages/bb-studio-mobile/) plugin (`mobile`). The app was called BB Go; its bundle IDs and app group
are unchanged, and old `bbgo://` links still open.

| Feature | Where |
|---|---|
| Home: the BB web sidebar on the phone, following its organization (Studio Sidebar's when it's installed). Automations, Pinned, your project groups in the sidebar's order, then Threads. Running threads first, then most recent activity; child threads nest under their parent; sections collapse | `iOS/Inbox/InboxView.swift` |
| By space: when the web sidebar shows By space, Home does too. Chips at the top switch between All and each Space (an amber mark when a thread there needs you; + makes a Space); Home starts on the Space the web sidebar shows and then remembers yours. A Space shows its lead (with its heartbeat), its open Studio items (tap to open, swipe to close), and its other threads, those that need you first. Rows are two lines: a status dot, the title and its age, and the thread's latest line from Studio, red when it failed and amber when blocked. The Space's ⋯ has New Thread Here, New Item, Browse Items, Archived Threads, Command View, Lead and Heartbeat, and Edit Space. A thread's long-press has Move to Space, Make Space Lead, and Hide; a section with hidden threads ends with "N hidden · Show". New threads start in the Space shown, in its default project | `iOS/Inbox/InboxView.swift`, `iOS/Inbox/SpaceHome.swift`, `Shared/Spaces.swift` |
| Swipe and context-menu actions: archive, delete (with confirmation), pin, read/unread, rename | `iOS/Inbox/InboxView.swift` |
| Search across thread titles and messages, active and archived | `iOS/Inbox/InboxView.swift` |
| New thread with project, provider, model, reasoning, and permissions (the choice becomes the project default, as in the web app). | `iOS/Inbox/NewThreadView.swift` |
| New thread workspace: project default, project checkout, new worktree with a base branch, or an existing environment | `iOS/Inbox/NewThreadView.swift` |
| Thread view with live updates, send, and stop. Opens at the newest message and follows new output only while you're at the bottom; a jump button brings you back. Older pages load as you reach the top, without moving what you're reading. File paths in messages (inline code like `docs/plan.md:12`, or Markdown file links) open in the file viewer, including absolute paths outside the workspace like `/tmp/shot.png`, read from the thread's host. The ⋯ menu has Voice chat, Find in thread, Rename, Model & permissions, Mute notifications, Open in BB web, Share link, and Copy Thread ID (also on a thread row's long-press) | `iOS/Thread/ThreadView.swift` |
| Live updates fetch only what changed: new rows since the last sequence, and the thread or its approvals only when those changed | `iOS/Thread/ThreadModel.swift` |
| A red "New" line where you left off; the thread opens there when there's something unread | `iOS/Thread/ThreadView.swift` |
| Find in thread: searches every message, with a match count and up/down to step through them | `iOS/Thread/FindBar.swift` |
| Drafts are kept per thread, and Home marks threads that have one | `iOS/Thread/Drafts.swift` |
| `@` suggests threads, recordings, pages, drawings, and artifacts, and sends them as real BB mentions | `iOS/Thread/MentionSuggestions.swift`, `Shared/Mentions.swift` |
| `/` searches the project's commands and skills and inserts the chosen command as a BB command mention | `iOS/Thread/CommandSuggestions.swift`, `Shared/ComposerCommands.swift` |
| The composer grows with the message, then offers a full-screen editor | `iOS/Thread/ThreadView.swift` |
| Change a thread's model, reasoning level, and permissions (Accept edits, Auto, Full access, up to the machine's ceiling) for its next turns. BB takes permissions with each message, so the choice goes out with the next one you send. Until then a card over the composer shows it, with Undo | `iOS/Thread/ExecutionSheet.swift` |
| File edits show `+N −M` and open to a red/green diff | `iOS/Thread/DiffView.swift` |
| Messages written while BB is unreachable wait in an outbox and send, in order, when it's back. Failures that may have reached BB wait for Try again, so nothing sends twice | `iOS/Thread/Outbox.swift` |
| Mute a thread's notifications (for all BB Studio devices, through the relay). Notifications group by thread | `iOS/Thread/MutedThreads.swift`, `packages/bb-studio-mobile/server.ts` |
| Read BB Pages (in Studio): each page's text, tables, callouts, stats, charts, and embeds. Embedded drawings, artifacts, recordings and other Studio items show as cards and open natively. Work with this page (a bar at the bottom starts a thread that knows the page), the page's past chats, rename, archive, and version history with save and restore. Comments (the toolbar button shows how many are open): read threads with the text they're on, reply, resolve or reopen, show resolved ones, and start a thread on any block. A thread started from a page links back to it | `iOS/Pages/` |
| Studio opens on the collection. Today (the sun button) shows Needs you with inline approvals and answers, working agents, recent items, and activity | `iOS/Studio/StudioHomeView.swift` |
| Studio search across items and threads, with legacy search fallback | `iOS/Studio/StudioView.swift` |
| Talk recording summaries: generation and regeneration for voice notes, ideas, and meetings | `iOS/Talk/RecordingsView.swift` |
| Related links, item threads, and comments with reply and resolve on Studio items | `iOS/Studio/RelatedSection.swift` |
| Studio Tables: read-only list and grid views | `iOS/Studio/TableView.swift` |
| Edit the whole page as one continuous Markdown text, styled as you type: headings stand out, checkboxes toggle on tap, and Return continues lists. Heading, list, checklist, link, and dictation controls sit above the keyboard. Edits autosave a moment after typing stops; the server rewrites only changed blocks through the live Yjs document, keeps blocks with comments intact, and asks for a reload if the page changed elsewhere. Empty pages open in the editor. Keep updated status and agent activity are visible on the page | `iOS/Pages/PageEditor.swift`, `iOS/Pages/PageTextView.swift`, `iOS/Pages/PageActivity.swift` |
| Automations: create agent schedules; edit names, prompts and schedules; browse runs by project, run now, pause and resume | `iOS/Tools/AutomationsView.swift`, `iOS/Tools/AutomationEditor.swift` |
| Drafts: long-press Send, then Save as Draft to park a message on the thread until you send it | `Shared/PluginExtras.swift` |
| Plan reviews: when an agent asks for a Plannotator review, a card opens the review UI; cancel from its menu | `iOS/Thread/PlanReviewSheet.swift` |
| Custom instructions: edit the text BB adds to every agent's system prompt (Settings → Agents) | `iOS/App/CustomInstructionsView.swift` |
| Usage, in Settings: each pooled Claude and Codex account's 5-hour and weekly limits, with reset times | `iOS/Tools/UsageView.swift` |
| Send later: long-press Send for 30 minutes, 1 hour, 3 hours, tomorrow at 9, or a picked time | `iOS/Thread/SendLater.swift` |
| Side chat: ask about one message in a hidden fork without derailing the thread | `MessageBubble` |
| Host settings: keep the Mac awake, and how many threads run at once | `iOS/Tools/ServerControls.swift` |
| Installed plugin status and errors in Settings → Plugins | `iOS/Tools/PluginStatusView.swift` |
| Files & changes: a thread's uncommitted changes with diffs, a file browser, file search, and file previews (images, rendered Markdown, text) | `iOS/Thread/FilesView.swift` |
| Pull request status and link for the workspace branch, when BB finds one | `iOS/Thread/FilesView.swift` |
| Terminals: BB's persistent terminals, from a thread's ⋯ menu (its workspace). A full VT terminal (SwiftTerm) with a key bar for Esc, Ctrl, Tab and arrows; new shell or run a command; rename, restart, close, paste, copy output, text size. Reconnects replay only missed output, and the shell keeps running when you leave | `iOS/Terminal/`, `Shared/Terminals.swift` |
| Edit the last message you sent, retry a failed turn, fork, inspect context usage, compact, clear context with confirmation, and resend a recent prompt | `ThreadView`, `iOS/Thread/ThreadContextView.swift`, `iOS/Thread/PromptHistoryView.swift` |
| Archived threads, in Settings: search, open, and unarchive | `iOS/Tools/ArchivedView.swift` |
| Drawings (in Studio): Excalidraw drawings rendered natively, with zoom, live updates while an agent draws, and share as an image, and rename | `iOS/Tools/DrawingsView.swift` |
| Create and edit drawings in the full Excalidraw editor inside the app, including pen, shapes, text, moving, deleting, and undo. Empty drawings open in the editor | `iOS/Tools/DrawingsView.swift` |
| Markdown in replies and your own messages: headings, nested and task lists, quotes, tables, code blocks with Copy, images (`![alt](path)`: files on the thread's host, absolute or from the workspace root, as BB web loads them, or web URLs; tap for full screen), and `@thread` mentions that show the thread's title and open it. Long messages of yours fold at 15 lines with Show more, as in BB web | `iOS/Thread/Markdown.swift`, `iOS/Thread/MarkdownImage.swift`, `iOS/Thread/Messages.swift` |
| Image attachments in a thread show three to a row; tap one to view it full size | `iOS/Thread/Messages.swift` |
| Emoji reactions from `::reactions{items="…"}`: tapping a chip drafts the reply (it doesn't send), as in BB web. Long-press a reply for the server's configured reactions; select text to react with its quote | `iOS/Thread/Messages.swift`, `Shared/ReactionSettings.swift` |
| Long-press a message: when it was sent, Copy, Select Text, Quote, Share. Long-press an edit or file read in the steps for Open File and Copy Path, or a command for Copy Command | `iOS/Thread/Messages.swift` |
| Tool activity collapses into one row per run ("3 commands, 2 edits"). Tap for each step and its output | `iOS/Thread/Messages.swift` |
| Edit a queued message or draft before it sends. Attachments stay, @-mentions stay while their text does, and the edit is refused if the message sent or changed meanwhile | `iOS/Tools/QueuedMessageEditor.swift`, `BBClient.editQueued` |
| The shelf above the composer: model fallback, plan mode (exit), goal (clear), background work, todo progress, and queued messages (tap to edit, send now, remove). Two or more queued messages fold into one "N queued" row; expanded, hold and drag to reorder, or use Move to Top / Up / Down | `iOS/Thread/ThreadShelf.swift` |
| Paste text or images into the composer. Images become attachments | `iOS/Thread/Composer.swift` |
| Answer approvals (command, file, permission, plan) and questions in the thread, including the ask-user-question plugin's multi-question forms and secret requests (values go straight to the server and aren't kept). Other plugin forms open the web app | `iOS/Thread/InteractionCard.swift`, `Shared/Interactions.swift` |
| Attachments from photos, the camera, or files (JPEG re-encoded, 35 MB limit) | `iOS/Thread/Attachments.swift` |
| Offline cache: the inbox and recent thread messages show before the network answers | `DiskCache`, `ThreadModel` |
| Connection banner when BB is unreachable (usually Tailscale off), with Open Tailscale and Retry | `ConnectionBanner` |
| Actionable notifications: Approve, Deny, Approve plan, and Answer from the lock screen. Multiple-choice questions get a button per option. Finished turns and errors are plain alerts; tap to open the thread | `iOS/App/NotificationActions.swift`, `NotificationService/`, `packages/bb-studio-mobile/apns.ts` |
| A thread's notifications disappear once it's read or answered, in the app or on another device (by the relay's silent push) | `iOS/App/NotificationActions.swift`, `packages/bb-studio-mobile/clear.ts` |
| Studio tab: pages, recordings, dictations, drawings, artifacts, and tables in one list, grouped by day, with kind and project filters, an Archived filter, search (titles plus the Studio plugin's content search, with the matching text shown in bold under the row), thumbnails for drawings and image artifacts, and swipe to delete or archive. Long-press for New Thread with This, each add-on's own actions (Copy Transcript, Copy as Markdown, Copy Text), Move to Project, and Archive or Restore. Capture tiles at the top: Dictate (long-press for Dictate a Page or Record), Write (a blank note, with a mic, that saves as a page or a thread and keeps its draft if you close it; long-press for New Page, Drawing and the rest), and Record. New (+) makes any kind Studio can create, like a page or a drawing, in the filtered project. Studio tags: colored tags on rows, tag filter chips, and Tags (toggle, New Tag…) on long-press, shown when the Studio plugin supports them; long-press a tag chip to rename or delete the tag. Select (also on search results) picks several items to archive or restore, move, tag, delete, or run an add-on's action on together. Uses the Studio plugin's overview when it's installed, or asks Pages, Talk, and Excalidraw directly | `iOS/Studio/StudioView.swift` |
| Item chat (with the Studio plugin): Chat About This on a drawing, artifact or recording starts a thread with the project's default agent that knows the item, or continues the item's last chat | `Shared/StudioChat.swift`, `iOS/Studio/StudioChatSheet.swift` |
| Spaces: a Space is its threads and Studio items. Items follow their project; each thread is in one Space (Personal unless moved). `bbstudio://space/<id>` opens the Space on Home. In Studio, a filter chip per Space; New in a filtered Space makes the item in its folder, and an item's long-press has Move to Space. Space settings rename, describe, set the default project or delete it (not Personal). A thread's ⋯ menu shows its Space, opens it, moves the thread to another, and makes it the Space's lead | `iOS/Studio/SpaceViews.swift`, `Shared/Spaces.swift` |
| Artifacts (in Studio): files agents save from threads. Markdown rendered (or as source), code and text in monospace, images zoomable, HTML and PDF in a sandboxed web view. Versions, share the file, copy text, New Thread with This, Save as Page, open the source thread, rename, move, delete. `::artifact{…}` cards in replies and Studio links in messages open natively. `::inline-vis{…}` previews in replies (BB's built-in inline-vis plugin): HTML visualizations from the workspace or thread storage run in a sandboxed web view at the reply's height, Markdown files render natively, with collapse, full screen, and the web app's errors for a missing file or bad height. Save Files to Studio (from the thread menu or a reply's long-press) lists the files a reply made plus the thread's storage, and saves the chosen ones as artifacts or new versions | `iOS/Studio/ArtifactView.swift`, `iOS/Studio/SaveToStudioSheet.swift`, `iOS/Thread/InlineVis.swift` |
| Dictation and recordings through the Talk plugin, with an offline segment outbox. Dictating from a text field (thread composer, page, note) puts the text straight into that field when you tap the check mark. A standalone dictation can be saved as a page, and recordings open to their transcript with share, copy, new thread, rename, retry of failed transcription, and delete. Play a recording: segments play back to back as one timeline with a scrub bar, back and forward 15 seconds, 0.75× to 2× speed, and lock-screen controls; the transcript comes in paragraphs with their start times, the sentence playing is highlighted, and tapping any sentence plays from there. Browser recordings are WebM/Opus, which iOS can't open, so the app demuxes them and decodes the Opus itself | `iOS/Talk` |
| Hands-free voice chat with one thread (on-device STT, then the thread, then TTS). You can talk over it, and pick the voice and speed in Settings. Uses the iPhone mic even with Bluetooth audio, restarts after calls and route changes, warns when the mic sends only silence, and links to Settings when a permission is off | `iOS/Voice` |
| Action button and Siri shortcuts: Dictate, Voice chat, Open thread, New thread, Write, "Ask BB" (Siri waits for the reply and reads it). Home Screen quick actions (long-press the icon): Dictate, Write, New Thread; `bbstudio://write` opens the same sheet | `iOS/App/Intents.swift`, `iOS/App/BBStudioApp.swift` |
| Capture to BB opens one sheet for voice, dictation, a note, a photo or file, or a new thread. Add it in Settings → Action Button → Controls; it is also available in Control Center, Shortcuts, and Siri. | `iOS/Capture/CaptureSheet.swift`, `Widgets/Controls.swift` |
| Control Center and lock screen controls: Dictate, Voice chat, New thread | `Widgets/Controls.swift` |
| The BB Studio theme's coral accent (#c7431a light, #ff7a45 dark, from the Silk S icon) on buttons, chips, your messages and unread dots, across the app, widgets, share sheet and watch. The BB Web tab follows the server's theme | `*/Assets.xcassets/AccentColor.colorset`, `project.yml` |
| Home and lock screen status widgets | `Widgets/StatusWidget.swift` |
| Work widget: thread attention and approvals, and running agents. Tap a thread or review link to open it | `Widgets/WorkWidget.swift` |
| Spotlight indexes open threads and Studio pages, recordings, drawings, and artifacts; removed items leave search. Handoff opens the current thread in the Mac browser | `iOS/App/Spotlight.swift` |
| Share extension: send text, links, images, and files to a new or existing thread | `Share/` |
| URL scheme `bbstudio://thread/<id>`, `page/<id>`, `automations`, `usage`, `archived`, `studio` (also `talk`, `pages`, `drawings`), `drawing/<id>`, `artifact/<id>`, `space/<id>` (or `space/all`), `new`, `dictate`, `voice[/<id>]`, `web`, `settings`. Links with the old `bbgo://` scheme still open | `AppModel.handle` |
| A Live Activity while a Talk recording is in progress | `Widgets/ItemActivities.swift`, `iOS/App/LiveItems.swift` |
| Shortcuts can select threads and pages; open a page, send to a thread, and start a Talk recording | `iOS/App/StudioIntents.swift` |
| iPad: sidebar tabs, a split view with the inbox beside the thread, a Find button, and a readable width for messages. A Thread menu in the menu bar. Keyboard: ⌘↩ send, ⌘N new thread, ⌘↓ latest, ⇧⌘M model, ⌘. stop; in find, ⌘G / ⇧⌘G step | `iOS/App/RootView.swift` |
| Haptics for sends, answers, errors, and swipe actions | |
| Watch app: inbox, last messages, dictated or quick replies, and answering approvals and questions (relayed through the phone) | `Watch/` |
| Watch complication: needs-you and running counts | `WatchWidgets/` |
| APNs push relay for BB's push-notifications plugin, with notification categories | `packages/bb-studio-mobile/` |
| Push registration replaces this install's prior subscription when APNs changes its token. Simulator and QA runs skip registration | `iOS/App/PushRegistration.swift` |

## Connection

The app talks to `https://patricks-megamac.tail5a01ec.ts.net`, which
`tailscale serve` proxies to BB on `127.0.0.1:38886`. BB has no client auth,
so the tailnet is the boundary. You can change the server in Settings.

Queued messages and recorded audio belong to the server where they were created.
Switching servers pauses that server's queued work until you switch back; sends
already in flight finish against their original server. Older queued messages
have no trustworthy server identity and wait for you to select their original
server and tap Try again. Older audio stays on the phone until you confirm its
server with Settings → Older recordings → Resume older uploads.

If saving a new audio segment fails, Talk stops the microphone and keeps the
source audio for Retry saving. It blocks finishing and closing until every
segment is durably queued; a late segment timeout is shown as a recoverable error.

Notification actions and links require the matching Studio Mobile relay's server
identity. Update the relay with the app; notifications received before this
identity was available must be reviewed manually in the app.

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

Unit tests use a private simulator clone:

```sh
export BB_TEST_SIMULATOR_ID=<your-private-simulator-id>
scripts/test.sh
```

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
   grant notification permission.
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
