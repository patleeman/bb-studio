# BB Studio

A personal native iOS and watchOS app for BB and
[BB Studio](https://github.com/patleeman/bb-studio): BB's threads, approvals,
terminals and automations, plus the Studio suite of plugins (Studio, Pages,
Talk, Draw, Design and apps; item chat ships inside Studio). Everything else opens the BB web
app in an in-app web view (the safari button on every thread, Pages, Drawings and Design).

Studio features need the matching plugins from the bb-studio marketplace on the
server. The app uses only those and the plugins that ship with BB, plus its own
push relay, the [Studio Mobile](../plugins/packages/bb-studio-mobile/) plugin (`mobile`). The app was called BB Go; its bundle IDs and app group
are unchanged, and old `bbgo://` links still open.

| Feature | Where |
|---|---|
| Home: the BB web sidebar on the phone, following its organization (BB's Thread List preferences). Automations, Pinned, your project groups in the sidebar's order, then Threads. Running threads first, then most recent activity; child threads nest under their parent; sections collapse | `iOS/Inbox/InboxView.swift` |
| Swipe and context-menu actions: archive, delete (with confirmation), pin, read/unread, rename | `iOS/Inbox/InboxView.swift` |
| Search across thread titles and messages, active and archived | `iOS/Inbox/InboxView.swift` |
| New thread is a chat: an empty conversation with the composer focused at the bottom (⌘↩ to start). Home pushes it (`Route.newConversation`; Back returns), with the conversation's own composer (`ComposerBar`, one row until focused, on the keyboard; the field grows to the room left above it, then scrolls, so Send stays in reach at any text size). Its message, photos and files are kept per Bot (`NewConversationDraft`) across Back, tabs and relaunches until it's sent or cleared. From Quick capture, a dictation or a recording it is a sheet with Cancel (`NewThreadSheet`). There is no project picker: a thread starts in the remembered project, else BB's personal one. A chip above the composer picks the workspace (project default, project checkout, new worktree with a base branch, or an existing environment); the composer's model button picks provider, model, reasoning and permissions. All start on the project's defaults | `iOS/Inbox/NewThreadView.swift` |
| Thread view with live updates, send, and stop. Opens at the newest message and follows new output only while you're at the bottom; a jump button brings you back. Older pages load as you reach the top, without moving what you're reading. File paths in messages (inline code like `docs/plan.md:12`, or Markdown file links) open in the file viewer, including absolute paths outside the workspace like `/tmp/shot.png`, read from the thread's host. The ⋯ menu has Find in thread, Rename, Model & permissions, Mute notifications, Open in BB web, Share link, and Copy Thread ID (also on a thread row's long-press) | `iOS/Thread/ThreadView.swift` |
| Live updates fetch only what changed: new rows since the last sequence, and the thread or its approvals only when those changed | `iOS/Thread/ThreadModel.swift` |
| A red "New" line where you left off; the thread opens there when there's something unread | `iOS/Thread/ThreadView.swift` |
| Find in thread: searches every message, with a match count and up/down to step through them | `iOS/Thread/FindBar.swift` |
| Drafts are kept per thread, and Home marks threads that have one | `iOS/Thread/Drafts.swift` |
| `@` suggests threads, recordings, pages and artifacts (whiteboards come with their page), and sends them as real BB mentions | `iOS/Thread/MentionSuggestions.swift`, `Shared/Mentions.swift` |
| `/` searches the project's commands and skills and inserts the chosen command as a BB command mention | `iOS/Thread/CommandSuggestions.swift`, `Shared/ComposerCommands.swift` |
| The composer is one card, as in ChatGPT: attachments, the field at full width, then + (attach), the model button (model and reasoning level; opens Model & permissions), dictate, and send. Until it's focused or holds a draft it is one row (+, the field, dictate, send), 40 pt shorter; the model button comes back with the keyboard. Over a home indicator alone (no keyboard, no tab bar: the folded Duo) it rests on the indicator's inset, with the background under it to the edge. Tap the mic to dictate inline, as on desktop: no sheet; the mic turns active and Listening (time, level, ✓ finish, ✕ cancel) shows over the composer while your words stream into the field after what you typed, in short segments as Talk transcribes them. Tap the mic again or ✓ to finish: the full transcript replaces the streamed words and stays in the field to edit and send. ✕ puts back what you typed. Leaving the thread or the app, or a sheet opening, finishes it into the field rather than losing words. Hold the mic to talk and send as before. A talk's status always shows in the one pill over the composer, never in the field. It grows with the message, then offers a full-screen editor. While dictation has words on the way (the mic's dictation or talk, or the keyboard's own mic), Send and ⌘↩ are off (VoiceOver reads "Listening…" or "Transcribing…" beside Send) until the text is in the field; an error, cancel or closing the sheet frees it. The keyboard's dictation is read from UIKit's input mode ("dictation"), its recording-ended, failed and result-placeholder callbacks on the field, and the next text change; the same input-mode check holds Send in New thread, Write, Capture note, page comments, Work with this page, Chat About This and queued-message edits | `iOS/Thread/Composer.swift`, `iOS/Thread/ThreadView.swift`, `iOS/Thread/DictationGate.swift` |
| Change a thread's model, reasoning level, and permissions (Accept edits, Auto, Full access, up to the machine's ceiling) for its next turns. BB takes permissions with each message, so the choice goes out with the next one you send. Until then a card over the composer shows it, with Undo. A Provider picker (BB's available providers) moves the thread to another provider: BB can't change a thread's provider, so Hand off calls Studio's `thread_handoff_to_model`, "Handing off to <provider>…" shows over the composer while Studio summarizes the thread into a new one (permissions carry over), and the app then follows the new thread (in the Bot chat, the bot's next thread) | `iOS/Thread/ExecutionSheet.swift`, `Shared/ModelHandoff.swift` |
| File edits show `+N −M` and open to a red/green diff | `iOS/Thread/DiffView.swift` |
| Messages written while BB is unreachable wait in an outbox and send, in order, when it's back. Failures that may have reached BB wait for Try again, so nothing sends twice | `iOS/Thread/Outbox.swift` |
| Mute a thread's notifications (for all BB Studio devices, through the relay). Notifications group by thread | `iOS/Thread/MutedThreads.swift`, `packages/bb-studio-mobile/server.ts` |
| Read BB Pages (in Studio): each page's text, tables, callouts, stats, charts, and embeds. Whiteboards (embedded drawings), artifacts, recordings and other Studio items show as cards and open natively. Work with this page (a bar at the bottom starts a thread that knows the page), the page's past chats, rename, archive, and version history with save and restore. Comments (the toolbar button shows how many are open): read threads with the text they're on, reply, resolve or reopen, show resolved ones, and start a thread on any block. A thread started from a page links back to it | `iOS/Pages/` |
| Studio search across items and threads | `iOS/Studio/StudioView.swift` |
| Talk recording summaries: generation and regeneration for voice notes, ideas, and meetings | `iOS/Talk/RecordingsView.swift` |
| Related links, item threads, and comments with reply and resolve on Studio items | `iOS/Studio/RelatedSection.swift` |
| Studio Design: a design's rounds, newest first, each a row of its live screens; tap or pinch one to open it full screen. It opens as a still of the screen (drawn once at the screen's own width under the view, then pictured), painted at once at fit-to-width and centred, in one scroll view: pinch to 6×, drag to pan, double-tap to zoom in and out, never smaller than fit, with a light bounce only at the edges. A tap or Play plays the live prototype, laid out at the screen's width from its first layout and zoomed by WebKit alone (start at a prototype step from Steps); View goes back to the still. Shows the reviewer's status and the comments; pinning new comments opens BB web. It reloads when the design plugin signals a change to this design, and after a socket reconnect, instead of polling | `iOS/Studio/DesignView.swift`, `iOS/Thread/ItemCard.swift`, `Shared/Designs.swift` |
| Studio mini apps, live: the app runs in a WKWebView holding its sandboxed frame, and the phone is its host, as BB's desktop is. It answers the frame's record calls (`minis.db.*`) and saves its shared state (`minis.live.save`), keeps the copy open for agent actions (`minis.live.open`, `touch`, `close`, `result`), and passes on other copies' state, record changes and agent commands from the `minis` realtime signal. Only messages from that frame are read. Network, BB access and sending to the agent are refused with "Open this app in BB on your computer to …"; access waiting for approval shows as a banner, approved on the desktop. Light and dark follow the phone. `::app{id}` cards for a mini app (and the older `::mini{id}`) run the app inline, as the desktop's do, under a header with its name and Open: the height fits the app's content (its `size` messages) between the manifest's `size.minHeight` and `size.maxHeight`. Drags over an app that fits scroll the thread; one taller than the card scrolls inside it. A card makes its web view only near the screen and drops it, closing its copy (`minis.live.close`), once far away, keeping its height; at most three run at once, cards on screen first, and a paused one runs on a tap. A web content process that dies loads again, up to three times a minute | `iOS/Studio/MiniAppView.swift`, `Shared/Minis.swift`, `iOS/Thread/MiniReplyCard.swift` |
| Studio reply cards: `::page`, `::drawing`, `::design`, `::recording` and `::app` lines (`::artifact` and `::mini` too; an app card picks a saved app or a live mini app by its id, as the desktop does, and so do page embeds) show the item under its name, read-only, as BB web does: the page's text, the drawing, the newest round's first screens, the recording's summary and first transcript lines, or the artifact's image, page, PDF or text. The eye button hides or shows every card's preview; tap the name to open the item | `iOS/Thread/ItemCard.swift`, `iOS/Studio/ArtifactView.swift` |
| Edit the whole page as one continuous Markdown text, styled as you type: headings stand out, checkboxes toggle on tap, and Return continues lists. Heading, list, checklist, link, and dictation controls sit above the keyboard. Edits autosave a moment after typing stops; the server rewrites only changed blocks through the live Yjs document, keeps blocks with comments intact, and asks for a reload if the page changed elsewhere. Empty pages open in the editor. Keep updated status and agent activity are visible on the page | `iOS/Pages/PageEditor.swift`, `iOS/Pages/PageTextView.swift`, `iOS/Pages/PageActivity.swift` |
| Automations: create agent schedules; edit names, prompts and schedules; browse runs by project, run now, pause and resume | `iOS/Tools/AutomationsView.swift`, `iOS/Tools/AutomationEditor.swift` |
| Drafts: long-press Send, then Save as Draft to park a message on the thread until you send it | `Shared/PluginExtras.swift` |
| Plan reviews: when an agent asks for a Plannotator review, a card opens the review UI; cancel from its menu | `iOS/Thread/PlanReviewSheet.swift` |
| Custom instructions: edit the text BB adds to every agent's system prompt (Settings → Agents) | `iOS/App/CustomInstructionsView.swift` |
| Usage, in Settings: each pooled Claude and Codex account's 5-hour and weekly limits, with reset times | `iOS/Tools/UsageView.swift` |
| Send later: long-press Send for 30 minutes, 1 hour, 3 hours, tomorrow at 9, or a picked time | `iOS/Thread/SendLater.swift` |
| A Bot's conversations (the Bot's list as home): + New conversation (`bot_conversation_start`); Reply in thread under and in the menu of every reply (`bot_thread_reply`), opening the thread as a sheet (pushed on iPad and the unfolded Duo), with "💬 N replies · time" and the last replier's mark under the message (`bot_side_threads`); Fork conversation from a reply's menu (`bot_fork_conversation`), opening as its own conversation under its parent; the model chip in the header (`thread_model`) and Model in ···; Archive (it saves a summary to memory first, `bot_finish`) and Delete conversation… (asks first; its workers and side threads go with it) in ···, on a row's swipe and long press in Conversations, never for Main or a working conversation, and Restore (`bot_reopen`) or Delete on the Archive's rows; on the folded Duo, ··· keeps Context and Share & notifications as submenus so it stays short; "N workers from here" above the composer (only on a Studio without strands); a compact input with dictation first. Side chat is hidden there. `[PASS]` reads "Quiet check" | `iOS/Bot/BotConversationChrome.swift`, `Shared/BotConversations.swift`, `ThreadView` |
| A Bot's workers open read-only, from the list's Workers (and its "N done") or the "N workers from here" line: the worker's transcript with no composer, its title and status in the header with the list's glyph (Running, Waiting for your approval, Waiting on an answer, Failed or Done, and how long ago), and over where the composer was its Bot, the conversation it works for (opens it) and its branch. "Ask the Bot about this worker…" sends the question with dictation to the Bot in that conversation (Main when it has none; `bot_worker_ask`) and goes there, back down the stack when it was open under the worker. A worker waiting on a question offers Answer it here; one waiting on an approval shows what it waits on with a link to the conversation that has its card ("Push to origin · Main ›"), and isn't resolved there. No Stop, edit or side chat on a worker. Status comes from `bot_threads_view` and `bot_thread_info` | `iOS/Bot/BotConversationChrome.swift`, `Shared/BotWorkers.swift`, `ThreadView` |
| Home (round 7, design 8a): the root page, the desktop's sidebar on one screen. Search as its first row (conversations, workers, Memory, Library, Studio's items, project threads), the Bot (its still, its name as a menu: switch Bot, Schedules, Theme, Settings; one status line, "2 running"), Memory and Library rows, the conversations (title and time, one line of preview, Working with a spinner) with their workers on a thin guide line under them ("N done" folded), Projects, and Archive. The app opens here; everything else is pushed over it, no sheets for places | `iOS/Home/HomeView.swift`, `iOS/Shell/ShellRoot.swift` |
| One bar on the iPhone (round 7, option A, 9b): back to Home, the title, a Workbench button with the tab count, and ⋯. In the Workbench the title is the shown tab ("Tab ▾", the conversation under it) and opens the tab menu: the tabs with a check, New tab…, Close. A sideways swipe flips Chat and Workbench; the composer stays under both | `iOS/Shell/ConversationScreen.swift`, `iOS/Workbench/WorkbenchView.swift` |
| Native navigation (round 8, as Kensico): SwiftUI's `TabView` with `.tabViewStyle(.tabBarOnly)` and four tabs: Home (the Bot and its conversations), Library, Memory and Search (`role: .search`, native `.searchable`). Each tab has its own `NavigationStack` (`Router`: one path per tab) with native bars: large titles on the tab roots, inline on pushed screens, the system's Back, and screen actions as toolbar items (`ScreenAction` is the data model; `.screenToolbar` renders it). The system places the chrome: on the folded Duo the bar's buttons and the tab bar's capsule go to the right column it reserves. A conversation's bar: its title, the Workbench button (Chat ⇄ Workbench, also a sideways swipe; the tab count is in its label, since SwiftUI's toolbar items take no badge) and ⋯; in the Workbench the title is the tab and opens the tab menu. The Duo by posture, from the window, the screen and the hinge (`UIHingeInteraction`, iOS 27.1; `ShellPosture`): folded and vertical are one column (vertical with type a step larger); book (half open) and flat lay out Home's tab by width and text size (`ShellPanes`): each pane has a minimum readable width that scales with Dynamic Type (the conversation about 60 characters a line, Home a name and its time, the Workbench a page at an iPhone's width); the Workbench pane shows only when the conversation has a tab the phone can show (a tab it can't show stays in the tab menu, marked "On your Mac" or why, and the Workbench button counts only the tabs it can show), with the conversation keeping about 58%; the conversation is its page's root (Kensico's detail page: no Back to an empty page); Home shows beside them only when all meet their minimums, else the Home button in the conversation's bar (or a swipe in from the screen's left edge, not while a screen is pushed) brings it over the conversation, modal to VoiceOver, taking the keyboard, and closed again when Home starts or stops fitting; where the conversation and a Workbench can't both be readable (xxLarge text and up on the Duo, 3 pt short at xxLarge), it is one big column. Memory's tab on two pages is Core | Skills and History, page two with its own stack (`Router.detail`). `-qaPosture` and `bbstudio://qa-duo/posture?<name>` force one in the simulator; `qa-duo/tab?bot|library|memory|search` picks a tab | `iOS/Shell/ShellRoot.swift`, `iOS/App/Router.swift`, `iOS/Shell/ShellPosture.swift`, `iOS/Shell/ShellGeometry.swift`, `iOS/Shell/ConversationScreen.swift` |
| The Workbench (round 7): a conversation's tabs from Studio (`threadWorkbenchGet`, `threadWorkbenchMutate`, refetched on `workbench-changed`), shown one at a time under the bar. The Workbench menu (a long press on the Workbench button, or the Workbench's title) adds tabs as the desktop's New Tab page does: New page, New whiteboard, New design, New app (Studio's `create`, `drawings.newWhiteboardPage`), Open link…, and New tab…, which finds a Studio item; what it adds opens shown, the Workbench in view (`WorkbenchAdd.swift`). Each tab's content is `WorkbenchTabContent(tab:)`; a tab's or pushed screen's actions (`.screenActions`) go in More | `iOS/Workbench/` |
| A clean conversation (round 7): the conversation's menu (⋯) holds Find, Rename, Model, Files, Terminals, Recent prompts, Save files, the source page, Context, Mute, Open in BB web, Share, Copy ID, Archive and Delete. Workers' approvals sit inline at the end of the transcript; the running time and the queue are one line inside the composer ("Working · 1m 12s … 2 queued"); a strand shows only as a small tag in a reply's footer (`strands.tags`). Live mode is in the composer's + menu | `iOS/Shell/ConversationMenu.swift`, `iOS/Thread/ThreadView.swift`, `iOS/Thread/ComposerChips.swift`, `iOS/Thread/Messages.swift` |
| One way in (`Router`): pushes, Spotlight, links (`bbstudio://`, `bb://`), widgets, the Watch, Siri, Home Screen quick actions and the app's own buttons all call `Router.open` with a `Destination` (a conversation, a worker, a Bot's place, a pushed screen, the list, New conversation, a Bot, Studio, Settings or a sheet). A destination that comes before Studio's Bots load waits in the router and opens once they have. The router is the app's one navigation model: what shows over the room, the shown Bot and conversation, what's pushed over it, and the room's open place | `iOS/App/Router.swift`, `iOS/App/AppModel.swift` |
| The Bot's controls (desktop's header and Bot settings): ⋯ beside the Bot on Home has Pause or Resume, Stop… (asks first: it also stops the threads the Bot started and turns off its schedules; nothing is deleted), the Main conversation picker (`bot_make_main`) and New Main (`bot_new_main`, asks first). `bot_spaces` says whether the Bot is paused or stopped: the header reads Paused or Stopped, and every conversation shows a line above the composer with Resume. A conversation's ⋯ has Make this the Main. The demo answers all of them offline (`-qaSpacesDemo`) | `iOS/Home/BotControls.swift`, `ThreadView` |
| The model router's notice and the Tool Gateway: in a Bot conversation, while the router has a usage-limit or sign-in notice (`router.notice.get`, every 2 min, longer while idle), a line above the composer says so with Hand off to <model> (`router.handoff`: a new thread on the router's next model continues this one, and the phone opens it) and ✕ (`router.notice.dismiss`). Settings ▸ Tool Gateway shows Studio's MCP servers (status, on or off, tool count) and the requests waiting for approval, view-only (`toolGateway.overview`): adding, approving and signing in happen on the desktop. A Studio without them answers "unknown method" and nothing shows. `-qaRouterDemo` answers the notice offline; the spaces demo answers the gateway | `iOS/Bot/RouterNotice.swift`, `iOS/Tools/ToolGatewayView.swift` |
| Host settings: keep the Mac awake, and how many threads run at once | `iOS/Tools/ServerControls.swift` |
| Installed plugin status and errors in Settings → Plugins. Today (Studio), Pages (Studio Pages), Drawings (Studio Draw) and Automations show "Install <plugin> to use this." when their plugin is missing or not running, instead of BB's raw 404 or 503 text | `iOS/Tools/PluginStatusView.swift`, `Shared/BBClient.swift` |
| Files & changes: a thread's uncommitted changes with diffs, a file browser, file search, and file previews (images, rendered Markdown, text) | `iOS/Thread/FilesView.swift` |
| Pull request status and link for the workspace branch, when BB finds one | `iOS/Thread/FilesView.swift` |
| Terminals: BB's persistent terminals, from a thread's ⋯ menu (its workspace). A full VT terminal (SwiftTerm) with a key bar for Esc, Ctrl, Tab and arrows; new shell or run a command; rename, restart, close, paste, copy output, text size. Reconnects replay only missed output, and the shell keeps running when you leave | `iOS/Terminal/`, `Shared/Terminals.swift` |
| Edit the last message you sent, retry a failed turn, fork, inspect context usage, compact, clear context with confirmation, and resend a recent prompt | `ThreadView`, `iOS/Thread/ThreadContextView.swift`, `iOS/Thread/PromptHistoryView.swift` |
| Archived threads, in Settings: search, open, and unarchive | `iOS/Tools/ArchivedView.swift` |
| Whiteboards (drawings in pages): a page's whiteboard opens natively, with zoom, live updates while an agent draws, share as an image, and rename. There is no separate Drawings list; whiteboards show in Studio under the Whiteboards kind | `iOS/Tools/DrawingsView.swift` |
| Edit a whiteboard in the full Excalidraw editor inside the app, including pen, shapes, text, moving, deleting, and undo. Empty whiteboards open in the editor. New ones are made in a page, not from New | `iOS/Tools/DrawingsView.swift` |
| Markdown in replies and your own messages: headings, nested and task lists, quotes, tables, code blocks with Copy, images (`![alt](path)`: files on the thread's host, absolute or from the workspace root, as BB web loads them, or web URLs; tap for full screen), and `@thread` mentions that show the thread's title and open it. Long messages of yours fold at 15 lines with Show more, as in BB web | `iOS/Thread/Markdown.swift`, `iOS/Thread/MarkdownImage.swift`, `iOS/Thread/Messages.swift` |
| Image attachments in a thread show three to a row; tap one to view it full size | `iOS/Thread/Messages.swift` |
| Emoji reactions from `::reactions{items="…"}`, and Pages' Next row (`::next{reply="…" btw="…" do="…"}`) as a "What next?" card with labeled Reply, Ask for and By the way rows, as in BB web. Replies are capsules; requests and note actions are dashed rounded squares. Every note has Tell me more, which drafts "💬 Tell me more: <note>" so the agent explains it in the thread, as on the web, and 🐛 notes have Fix this. Tapping any chip drafts it (it doesn't send). Long-press a reply for the server's configured reactions; select text to react with its quote | `iOS/Thread/Messages.swift`, `Shared/ReactionSettings.swift` |
| Long-press a message: when it was sent, Copy, Select Text, Quote, Share. Long-press an edit or file read in the steps for Open File and Copy Path, or a command for Copy Command | `iOS/Thread/Messages.swift` |
| Tool activity collapses into one row per run ("3 commands, 2 edits"). Tap for each step and its output | `iOS/Thread/Messages.swift` |
| Edit a queued message or draft before it sends. Attachments stay, @-mentions stay while their text does, and the edit is refused if the message sent or changed meanwhile | `iOS/Tools/QueuedMessageEditor.swift`, `BBClient.editQueued` |
| The shelf above the composer (plain BB threads; a Bot conversation shows these as composer chips and transcript lines): model fallback, plan mode (exit), goal (clear), background work, todo progress, and queued messages (tap to edit, send now, remove). Two or more queued messages fold into one "N queued" row; expanded, hold and drag to reorder, or use Move to Top / Up / Down | `iOS/Thread/ThreadShelf.swift` |
| Paste text or images into the composer. Images become attachments | `iOS/Thread/Composer.swift` |
| Answer approvals (command, file, permission, plan) and questions in the thread, including the ask-user-question plugin's multi-question forms, Studio Design's questions before designing (picks, toggles, short answers, 1–5 scales, Decide for Me, Skip All), and secret requests (values go straight to the server and aren't kept). Other plugin forms open the web app | `iOS/Thread/InteractionCard.swift`, `Shared/Interactions.swift` |
| Attachments from photos, the camera, or files (JPEG re-encoded, 35 MB limit) | `iOS/Thread/Attachments.swift` |
| Offline cache: the inbox and recent thread messages show before the network answers | `DiskCache`, `ThreadModel` |
| Connection banner when BB is unreachable (usually Tailscale off), with Open Tailscale and Retry | `ConnectionBanner` |
| Worker approvals: an Approve/Deny card in the composer's slot of the conversation that owns the worker (Main for one with no conversation), as desktop's live cards: the worker it came from (opens it) and "asks for your approval", what it asks for, its details as BB's prompt shows them, then Deny, Approve for this worker (when BB offers it) and Approve. They come from `bot_conversation_approvals` (every 10 s while one waits, else 30 s, and when the conversation's needs-you or workers change) and resolve through `bot_worker_approval_resolve`; the card then says Approved, Approved for this worker or Denied for a moment and goes, and the list refreshes. Offline, a tap fails on the card ("Not sent. You're offline. …") and is never queued | `iOS/Bot/WorkerApprovalCards.swift`, `Shared/BotApprovals.swift`, `ThreadView` |
| Actionable notifications: Approve, Deny, Approve plan, and Answer from the lock screen. Multiple-choice questions get a button per option. Finished turns (the Bot's messages too) get Reply, which sends to the thread; errors are plain alerts; tap to open the thread. While the app is open, a plain reply (`turn-finished` that isn't an ask) goes to Notification Center without a banner or sound; needs-you, asks, approvals and errors still show a banner (`NotificationActions.foregroundOptions`). Approve and Deny on a worker's approval (the push's `workerId`, else Studio's `bot_thread_info` says the thread is a worker) go through `bot_worker_approval_resolve`; plans and other threads keep BB's own resolve. A failed action, offline included, posts a notification saying it didn't go through and nothing was queued | `iOS/App/NotificationActions.swift`, `NotificationService/`, `packages/bb-studio-mobile/apns.ts` |
| A thread's notifications disappear once it's read or answered, in the app or on another device (by the relay's silent push) | `iOS/App/NotificationActions.swift`, `packages/bb-studio-mobile/clear.ts` |
| Studio tab: pages, recordings, dictations, whiteboards and apps in one list (one Apps kind for saved files and mini apps), grouped by day, with kind and project filters (each kind is a page: swipe sideways between All, Pages, Recordings and the rest, while a swipe on a row still opens its actions; the chips stay pinned above), an Archived filter, search (titles plus the Studio plugin's content search, with the matching text shown in bold under the row), thumbnails for drawings and image artifacts, and swipe to delete or archive. Long-press for New Thread with This, each add-on's own actions (Copy Transcript, Copy as Markdown, Copy Text), Move to Project, and Archive or Restore. Capture tiles at the top: Dictate (long-press for Dictate a Page or Record), Write (a blank note, with a mic, that saves as a page or a thread and keeps its draft if you close it; long-press for New Page, Drawing and the rest), and Record. New (+) makes any kind Studio can create, like a page or a drawing, in the filtered project. Studio tags: colored tags on rows, tag filter chips, and Tags (toggle, New Tag…) on long-press, shown when the Studio plugin supports them; long-press a tag chip to rename or delete the tag. Stars: Starred sits above the days on All, newest-starred first (Studio's `starred`; hidden while empty, searching, selecting or in the archive, and on a Studio without stars); swipe a row right, or long-press, to Star or Unstar (`starItems`), and every item's screen has a star in its bar, filled while starred. Changes show at once and refetch on Studio's realtime signal; `-qaStudioDemo -qaStudioStars` draws three starred pages offline. Select (also on search results) picks several items to archive or restore, move, tag, delete, or run an add-on's action on together. Uses the Studio plugin's overview when it's installed, or asks Pages, Talk, and Excalidraw directly | `iOS/Studio/StudioView.swift` |
| Item chat (with the Studio plugin): Chat About This on a whiteboard, artifact or recording starts a thread with the project's default agent that knows the item, or continues the item's last chat | `Shared/StudioChat.swift`, `iOS/Studio/StudioChatSheet.swift` |
| Artifacts (in Studio): files agents save from threads. Markdown rendered (or as source), code and text in monospace, images zoomable, HTML, PDF, audio and video in a sandboxed web view (WebKit plays media with its own controls). Versions, share the file, copy text, New Thread with This, Save as Page, open the source thread, rename, move, delete. `::app{…}` and `::artifact{…}` cards in replies and Studio links in messages open natively. `::inline-vis{…}` previews in replies (BB's built-in inline-vis plugin): HTML visualizations from the workspace or thread storage run in a sandboxed web view at the reply's height, Markdown files render natively, with collapse, full screen, and the web app's errors for a missing file or bad height. Save Files to Studio (from the thread menu or a reply's long-press) lists the files a reply made plus the thread's storage, and saves the chosen ones as artifacts or new versions | `iOS/Studio/ArtifactView.swift`, `iOS/Studio/SaveToStudioSheet.swift`, `iOS/Thread/InlineVis.swift` |
| Dictation and recordings through Studio, with an offline segment outbox. Dictating from a page or a note puts the text straight into that field when you tap the check mark (the thread and New thread composers dictate inline instead). A standalone dictation can be saved as a page, and recordings open to their transcript with share, copy, new thread, rename, retry of failed transcription, and delete. Play a recording: segments play back to back as one timeline with a scrub bar, back and forward 15 seconds, 0.75× to 2× speed, and lock-screen controls; the transcript comes in paragraphs with their start times, the sentence playing is highlighted, and tapping any sentence plays from there. Browser recordings are WebM/Opus, which iOS can't open, so the app demuxes them and decodes the Opus itself | `iOS/Talk` |
| Hands-free voice with the Bot (see [Dictation and hands-free voice](#dictation-and-hands-free-voice)): GPT-Live over WebRTC from the open conversation's waveform (it speaks as that conversation), or Talk to Bot, which means the current Bot's Main (`bbstudio://bot-talk/<botId>` for another Bot's) | `iOS/VoiceLive` |
| Action button and Siri shortcuts: Dictate, Open thread, New conversation, Write, "Ask BB" (Siri waits for the reply and reads it). Home Screen quick actions (long-press the icon): Dictate, Write, New Conversation; `bbstudio://write` opens the same sheet | `iOS/App/Intents.swift`, `iOS/App/BBStudioApp.swift` |
| Capture to BB opens one sheet for voice, dictation, a note, a photo or file, or a new thread. Add it in Settings → Action Button → Controls; it is also available in Control Center, Shortcuts, and Siri. | `iOS/Capture/CaptureSheet.swift`, `Widgets/Controls.swift` |
| Control Center and lock screen controls: Dictate, New thread | `Widgets/Controls.swift` |
| The BB Studio theme's coral accent (#c7431a light, #ff7a45 dark, from the Silk S icon) on buttons, chips, your messages and unread dots, across the app, widgets, share sheet and watch. BB web views follow the server's theme | `*/Assets.xcassets/AccentColor.colorset`, `project.yml` |
| Old to-do and loop cards are gone (round 7): an old `::loop{id}` or `::work{id}` line in a message shows nothing, and a loop push has no lock-screen buttons | `iOS/Thread/Markdown.swift` |
| Widgets on Bot spaces: Status, Bot and Work read `bot_spaces` and `bot_threads_view` for one Bot, chosen in the widget's settings (Edit Widget → Bot; empty follows the current Bot), and show its presence still. Needs you lists its conversations that need you and workers waiting on you; Running lists conversations with a turn running and running workers. The app redraws them when a Bot's presence, workers or latest line change. The rows below describe the fallback for a Studio without Bot spaces | `Widgets/BotWidgetIntents.swift`, `Shared/BotWidgetData.swift` |
| Home and lock screen status widgets: what needs you is the Bot's attention (`bot_attention`: its count, and its reason such as "Asked you a question" as the headline, opening the Bot), then what's running. From a Studio without `bot_attention`, or when it fails, they count BB's threads waiting on you as before. Large lists Needs you (the Bot's reason, then each thread waiting on an answer or failed, with its age) and Running with ages, each row opening its thread; extra large (iPad) puts the two lists side by side. `-qaStateDemo widgets` draws the widgets' views in the app for screenshots (`widgets-bot`, `widgets-work`; all three extra large on an iPad; `-qaWidgetState empty` or `placeholder` for the empty and redacted states) | `Widgets/StatusWidget.swift`, `Widgets/WidgetParts.swift`, `Shared/ThreadSummary.swift` (`NeedsYouCount`) |
| Bot widget large and extra large: the latest message (never a `[PASS]`: the widgets show the last real reply) with more text (an approval first, with Approve and Deny; with none on the Bot's own thread, the first worker approval waiting in Main, answered through `bot_worker_approval_resolve`), Working on (the threads it started or waits behind, from `bot_activity`, fetched only for these sizes) and Earlier (the four messages before the latest, cut to 200 characters), plus the mic. Extra large puts the message on the left and the lists on the right | `Widgets/BotWidget.swift` |
| Work widget: the Bot's attention (its reason, opening the Bot; BB's waiting threads on an older Studio) and approvals, and running agents. Tap a thread or review link to open it. Extra large (iPad): Needs you with the threads waiting on an approval on the left, every running thread with its age on the right | `Widgets/WorkWidget.swift` |
| Spotlight indexes open threads and Studio pages, recordings, whiteboards, and artifacts; removed items leave search. Handoff opens the current thread in the Mac browser | `iOS/App/Spotlight.swift` |
| Share extension: send text, links, images, and files to a Bot's conversation: Main by default, any of its open conversations, or New conversation (`bot_conversation_start`), with a Bot picker when there are several (the last one is remembered). No project picker. On a Studio without Bot spaces: a recent thread, or a new thread in the remembered project | `Share/` |
| URL scheme `bbstudio://thread/<id>`, `reply/<id>` (opens the thread and its reply), `page/<id>`, `automations`, `usage`, `archived`, `studio` (also `talk`, `pages`), `drawing[/<id>]` (also `drawings`; both open Studio on Whiteboards, and an id opens that whiteboard), `artifact/<id>`, `design/<id>`, `recording/<id>`, `new`, `capture`, `dictate`, `record`, `write`, `handsfree` (hands-free voice), `bots` (the list), `bot[/<id>]` (also `chief`, and the old `web`, for the primary bot), `bot-talk` (also `chief-talk`; opens hands-free voice and starts it, or ends it), `settings`. Links with the old `bbgo://` scheme still open | `AppModel.handle` |
| BB links (`bb://<kind>/<id>`, desktop's router ported to Swift, `iOS/App/Links.swift`): in replies, pages and cards, `bb://`, `::page{…}`-style directives, `page:`/`thread:` references and BB's own addresses open natively, checked first with `links.resolve` ("Not found: …" when gone). `bbstudio://<kind>/<id>` is the same link for every kind (conversation, worker, bot, the five Bot pages, automation, todo, record, page, whiteboard, design, app, artifact, recording, board; a dashboard link says it opens on the Mac); with the Bot's list as home they open in it, threads included. Files and diffs open from their thread, browser links in Safari; VS Code, terminals and workflow runs say where they open. `bb` itself isn't registered with iOS, so it never clashes with BB's own app | `iOS/App/Links.swift`, `iOS/App/AppModel.swift` |
| A Live Activity while a Talk recording is in progress | `Widgets/ItemActivities.swift`, `iOS/App/LiveItems.swift` |
| A Bot Live Activity and Dynamic Island (design 10e), only while a turn you started from the phone runs or asks you something: a message sent from the app, a new conversation, or a question about a worker (`PhoneTurns`, kept 30 minutes; a scheduled send doesn't count). It shows status only: the presence still, the conversation and its state ("Main · Thinking…"), and what needs you in amber, never an old line or a `[PASS]`; the expanded island has Deny and Approve for a worker approval (`bot_worker_approval_resolve`); a tap opens the conversation. Workers alone never start or keep one. It counts a just-sent turn as running for 20 seconds until BB says so, and ends at once when the turn finishes, since the reply's notification says so. While the app is open it starts and updates them from `bot_spaces` and `bot_threads_view`; it registers its push-to-start token per Bot and each activity's update token with the relay (`live_activity_register`), so Studio can update and end them while the app is closed. Studio's side is specified in [docs/live-activity-server.md](docs/live-activity-server.md) and not built yet. `-qaStateDemo widgets-live` draws the views | `LiveActivity/BotActivityAttributes.swift`, `iOS/App/BotLiveActivities.swift`, `Widgets/BotLiveActivity.swift`, `Shared/PhoneTurns.swift` |
| Shortcuts can select threads and pages; open a page, send to a thread, and start a Talk recording | `iOS/App/StudioIntents.swift` |
| iPad: sidebar tabs, a split view with the inbox beside the thread, a Find button, and a readable width for messages. A Thread menu in the menu bar. Keyboard: ⌘↩ send, ⌘N new thread, ⌘↓ latest, ⇧⌘M model, ⌘. stop; in find, ⌘G / ⇧⌘G step | `iOS/App/RootView.swift` |
| Haptics for sends, answers, errors, and swipe actions | |
| Watch app: inbox, last messages, dictated or quick replies, and answering approvals and questions (relayed through the phone). A thread that fails to load shows the error with Retry; a deleted thread says "This thread no longer exists." and stops polling | `Watch/` |
| Watch complication: the Bot's attention (its reason, else a count; BB's waiting threads on an older Studio) and running counts, sent by the phone in `StatusSnapshot` | `WatchWidgets/` |
| APNs push relay for BB's push-notifications plugin, with notification categories | `packages/bb-studio-mobile/` |
| Push registration replaces this install's prior subscription when APNs changes its token. Simulator and QA runs skip registration | `iOS/App/PushRegistration.swift` |

## A conversation: opening and sending

A conversation opens on what the phone last saw: Studio's Bots
(`BotSpacesCache`) and the thread's last 50 messages
(`TimelineCache`, one JSON file per thread, written after each load and
update). With nothing cached it shows grey bubbles (`ChatSkeleton`), not a
blank screen. The server's page goes in over the cached rows by id
(`TimelineMerge`), so nothing redraws or jumps when they match. A sent
message shows at once, faded, until the server's row for it replaces it
(`PendingSend`). "Scroll to the bottom" goes to a marker view at the end of
the chat rather than the lazy stack's edge, which could leave the chat blank
after a send with the keyboard up. Only a short scroll from near the bottom animates, toward the edge;
farther ones jump to the marker, since an animated scroll to an id in a lazy
stack re-aims as rows above measure and visibly runs through the chat.

Signposts time the open (Points of Interest, `BotChatOpen`; `ChatPerf`).
Debug builds print `[perf]` lines to stderr. To measure, launch with
`simctl launch --console` and `-qaBotDemo chat -qaDemoLatency 600`: a local
fake server serves a 300-message chat (`-qaDemoMessages`) through
`BBClient.transport`. `-qaDemoColdCache` drops the caches first, and
`-qaDemoSend <text>` types a message and sends it.

Typing must not lag while a thread is busy. The draft lives outside
`ThreadView`'s own state, so a key redraws only the composer, and it is saved
once typing pauses. `-qaBurstDemo` measures keystroke latency while a burst of
events lands in a long thread with large tables, and `TypingBurstUITests`
checks it. See [typing during a burst of thread events](docs/typing-lag.md).

The thread view's body stays cheap and runs only when something it draws
changes. Two watchdog kills on the Duo (0x8BADF00D, 10 s of main-thread
CPU; Oct 26), one while answering a Bot question and one while the window
changed, were that body running over and over on a long chat: the scroll
position lived in the view's own state, so each scroll request (the
restore after a fold or a pane change asks ten times a second) redrew the
whole thread, and each redraw rebuilt a set of every row id and diffed every
row. The position now lives in `TranscriptScroller`, read only by a small
modifier and bound one way; the row ids and grouped items are worked out in
`ThreadModel` once per change; and geometry readers write only real
changes. `TranscriptHangUITests` counts redraws, geometry writes and the
longest main-thread stretch (`bbstudio://qa-duo/counts`, Debug builds) while
a question is answered over a 1,000-message chat (`-qaDemoQuestion`) and
while the Duo folds, splits, resizes its list and comes back from the
background with the keyboard up; `TEST_RUNNER_HANG_MESSAGES` sets the
chat's length.

A tap on the transcript puts the keyboard away, but not a tap on a row's
text field. On TestFlight 2144, a tap on a pending secret request's field
took the keyboard from the composer and ended editing straight after, so
nothing could be typed there. `InteractionFieldUITests` types fake values
into a secret request's field, a question's answer field and the
ask-user-question plugin's field (`-qaDemoQuestion secret|plugin|question`),
both in the Bot chat and as a transcript row, then taps the transcript to
check that it still closes the keyboard. Set `TEST_RUNNER_TRANSCRIPT_V2=0`
for the old transcript and `TEST_RUNNER_INTERACTION_LAYOUT=outer` for the
Duo's outer screen.

Nothing of ours reloads the keyboard while the window resizes under it. A
third crash on the Duo (TestFlight 1421) was the keyboard itself, in the
split transition it runs around the fold, removing a constraint Auto Layout
had already broken, after a reload of its input views. The window probe
used to set the regular size class from inside every resize's layout pass,
and a trait change on the first responder's chain reloads the keyboard;
the composer also took or gave up focus on the next run loop whatever the
window was doing. Now the size class is set only when it changes, after the
layout pass, and with the keyboard up only once the window has kept its size
for 0.4 s (`ResizeSettling`); the composer's focus changes and the
transcript's tap-to-close wait the same way.

**Crash breadcrumbs.** The last 200 keyboard, window, pane, focus and scene
events (frames, sizes and ids, never message text) are kept in memory and
written to Application Support about once a second and on each scene phase
change, with the scroll log on or off (`Breadcrumbs`). A launch after a
session that was still in front when it ended keeps that file, and Settings
▸ Diagnostics offers **Share last crash breadcrumbs** and a Clear.

## Bot chat: terminals

The Bot chat's ⋯ menu has **Terminals**, the same item a regular thread's ⋯
menu has: it opens the terminals of the Bot's current chat thread, scoped to
that thread (`TerminalScope.forThread` in `Shared/Terminals.swift`), so a
one-off script doesn't need a new thread. Like a regular thread, it shows once
the thread has an environment; the chat's `ThreadView` reports it to the Bot
tab (`BotChrome.environmentChanged`). `BotTerminalUITests` checks it on
`-qaBotDemo chat`.

## Expand to page

When a message grows into meeting notes, the note button beside the mic in a
thread's composer (the Bot's chat too) moves the draft into a Notes page linked
to the thread, as on desktop (`notes.create`). The composer is cleared once the
server has saved the text; attachments stay in it. With a note already open,
the button adds the draft to the end of it. The note opens full screen in the
page editor (`PageEditor`), which writes every change to the phone at once and
to BB a moment after typing stops, and right away when you leave the app. The
format bar's mic dictates into it, and so does the keyboard's.

While the note is open, a **Notes in progress** chip above the composer
reopens it (`notes.forThread`, read on appear and on Studio's `pages` signals;
no polling). The editor's toolbar has the done actions: **Send to thread**
(`notes.send`, auto: the Markdown, or a link and "Summarize these notes" when
it's long), **Keep as page** (asks for a title; `notes.keep`) and **Discard**
(asks first; `notes.discard`). Send and Keep save the latest typing first, and
wait while dictation still has words on the way.

Debug builds show these with no server: `-qaBotDemo chat -qaNotesDemo
draft|chip|editor|keep|discard` (`iOS/Thread/NotesDemo.swift`).

## Visual Chat

With the Visual Chat plugin (`studio-visual-chat`) running, the Studio tab has
a Visual Chat card. It opens the chats (`canvas.list`) and New chat; a chat is
the board, filling the screen, over one chat line at the bottom: the caption
(two lines), ‹ › through the versions (`canvas.version`, `canvas.view`), the
field, Talk's dictation and Send. A new chat and every message go out with the
screen the user is on (`client: { kind, width, height }`: a phone, the folded
or open Duo), so the agent composes for it. It runs on the chat's default model
(Sonnet 5.5); there's no model picker, and hands-free voice comes later.

The board is drawn by the plugin's own renderer, the same code as the desktop
page (`canvas.renderer`: one script, kept on disk per server by its version
and checked against it, so it downloads only when the plugin changes). It runs
in a web view whose top document is the app's: a small host page on a
`https://visual-chat.invalid/` origin that's never fetched, with no stored data
(`.nonPersistent()`). The agent's page is in the same sandboxed frame as on the
desktop (`allow-scripts`, an opaque origin), and maps, videos, songs and
webpage parts are frames beside it, placed by the renderer. The top document
never navigates; it reaches the app only through four bridge messages
(`ready`, `open`, `webpage`, `rendered`, parsed strictly and only from the top
frame). Open on a webpage part, and a link from an embed's popup, open in
Safari's view. The page the agent is writing streams in from the plugin's
realtime channel, as on the desktop, and the board lands on the finished page.
A board from before pages (items) isn't drawn on the phone.
On the folded Duo's outer screen the chat hides the navigation bar, whose
buttons iOS would put in the right-hand column, and draws its own header row:
back beside the title, as on an iPhone. The clock's column on the right is a
real safe-area inset there, so the board and the chat line run up to it and
leave it clear. The chat list keeps the app's usual column.

`VisualChatStillsUITests` takes the stills from a staged BB
(`TEST_RUNNER_BBGO_QA_SERVER`; see the test for its other settings).

## Dictation and hands-free voice

The composer has one mic and one indicator, as on desktop (Studio's page
"Composer: one recording surface"): one red recorder pill over the composer
with the time, your level, ✕ and ✓, and "Listening…" in the field's
placeholder, not beside the buttons (`iOS/Thread/TalkIndicator.swift`). Tap
the mic to dictate inline; hold it to talk and send (`iOS/Thread/HoldToTalk.swift`).
Inline dictation cuts phrase-length segments (2.5 s target, 8 s max, 300 ms
pause), so the words land in the field as Talk transcribes them.

The meters and the mic's polling share one 10 Hz clock (`VoiceClock`) that
runs only while something is listening and stops while the app is inactive;
there are no per-frame animations. Debug builds show the dictating pill with
no server or mic: `-qaBotDemo chat -openURL bbstudio://bot -qaDictation listening`.

Talking with the Bot out loud is hands-free voice (`iOS/VoiceLive`, the
waveform in the Bot tab's header): GPT-Live over WebRTC, with Studio's tool
layer. Talk to Bot (the Action button, the Siri shortcut, `bbstudio://bot-talk`)
opens it and starts the session at once; run it again to end it. See
[docs/voice/spike.md](../../docs/voice/spike.md).

The old in-thread voice mode (a speaker beside the mic that spoke replies in
Studio's voice, push to talk, Read Aloud and Settings → Voice) was removed on
Nov 1; [docs/voice/removal-list.md](../../docs/voice/removal-list.md) lists
what went. Before that, New voice chat was removed:
[docs/ios/no-voice-chat](../../docs/ios/no-voice-chat/README.md).

Tapping the mic in any composer dictates inline the same way (see the
composer row above); here in New thread, the words streaming in after what
was typed:

## Look

Settings → Look picks the phone's theme: On Air (graphite, design 10a; the
default), desktop's 8 Classic themes and its 9 scene themes. "Follow each
Bot's theme" uses the theme a Bot wears on the Mac (`appearance.themeId`).
Colors, glass opacity and the halo come from desktop's own `resolveLook`:
`scripts/build-look.mjs` writes them to `Shared/Look/looks.json`, and bundles
desktop's scene engine, its six scene drivers, the 8 presence forms and the
presence sandbox (`plugins/packages/bb-studio/src/{theme,presence}`, plus
`Look/web/`) into `iOS/Look/Resources/look.js`. Both outputs are committed;
run `node scripts/build-look.mjs` after a desktop theme or presence change
(`--check` fails when they are stale). It needs `plugins/node_modules`.

- **Scenes.** A scene shows as a still behind the Bot's list, never behind a
  conversation. The still is rendered on the phone by desktop's renderer at the
  theme's `still` time, once per theme, mode and size (and once an hour for the
  clock- and weather-driven ones), then cached (`SceneStills`). It shifts with
  tilt through a system motion effect, which wakes the app at the display's
  rate, so the tilt rests while the app is idle.
  "Live scene" is opt-in: foreground only, never in Low Power Mode, once the
  phone is warm (thermal state fair or above) or with Reduce Motion, at 15
  frames a second. A driver's chosen mode (Tonight's Sky by day) switches the
  look, as on desktop.
- **Energy.** `EnergyGate` watches touches and typing. After 30 s without
  either the live scene and the live presence hold their frame until the next
  touch and the still's tilt rests; the scene also holds while the keyboard is
  up; and every screen's polls wait 3 times longer (at most 3 minutes; 5
  minutes once nobody has touched the phone for 5 minutes). Low Power Mode and
  a warm phone (thermal state fair or worse) stretch polls the same way even
  in use. Those polls also hold while the app is in the background. A
  conversation polls side threads every 30 s, its workers and approvals every
  60 s (10 s while an approval waits), strands every 30 s and the router's
  notice every 2 min. BB's change signals are paced too: while idle the thread
  list reloads at most every 30 s and the Bots' spaces flush at most every
  30 s (5 min at rest), and the socket drops its thread-list subscription
  (every thread's "events appended" on a busy Mac) until the next touch, which
  subscribes again and catches up. An open thread keeps its own subscription.
  The socket opens as `/ws?listEvents=status`: a BB Studio server then leaves
  other threads' "events appended" off the list (seam `list-quiet`); others
  ignore it. "Connected" (everyone catches up) is said once when the socket
  starts, at launch and each return to the front, and again only when a socket
  that failed or dropped opens again (its first pong), so retries while the
  Mac can't be reached don't make every screen reload.
  Studio's list reloads on Studio's signals only while a Studio list shows;
  off screen it reloads when it shows again, and Bot turns never reload it.
  `HeatScreensUITests` measures five screens offline with the probe on
  (`TEST_RUNNER_HEAT_OUT`; it skips without it). The scene and
  presence loops wake once per frame they draw (`FrameClock` in
  `Look/web/runtime.ts`), not at the display's rate. The live presence runs at
  30 frames a second, 15 on a warm phone, and stops at serious thermal state.
  Small looping motion (the room's spinners and Now pulse, the workers sheet's
  spinner) are Core Animation animations at 30 fps (`LayerMotion`), so they cost
  the app nothing per frame. Debug builds with `-qaEnergyProbe` log main-thread
  wakeups, look web view frames and requests per minute every 10 s to stderr
  and `Documents/energy-probe.txt`.
- **Glass.** Liquid Glass (`glassEffect`) tinted by the theme's surface color at
  desktop's glass opacity; bare text over a scene gets desktop's halo.
- **Presence.** All 8 forms and agent-made ones (their code from
  `presences_list`). A Bot shows a cached still while idle and its form live
  while it thinks, works (a satellite per worker) or needs you (amber), unless
  motion isn't allowed. Light themes get desktop's halo. Each Bot's four state
  stills go to the app group (`Look/presence/<hash of bot id>/<state>.png`)
  for widgets and the Live Activity.
- **Sandbox.** `LookWebView` loads only `bblook://look/…` from the bundle, a
  content rule list blocks http(s), ws(s), ftp and file loads, the presence page's
  CSP has `connect-src 'none'`, agent-made code runs in desktop's own Worker
  sandbox (fetch, XMLHttpRequest, WebSocket and the rest removed), storage is
  non-persistent, and the scene page may reach only `theme.weather` and
  `theme.sky`, which the app forwards read-only.
- **Tests.** `LookTests` renders every scene and every form and state, checks the
  sandbox has no network API, and measures idle CPU with a still on screen and
  the live scene's frame cap (`LOOK-PERF` lines). `LookUITests`
  (`-qaLookTheme <id>`, `TEST_RUNNER_LOOK_OUT`) screenshots each theme.

## Connection

The app talks to the BB server you give it, such as
`https://your-mac.your-tailnet.ts.net`, which `tailscale serve` proxies to BB
on `127.0.0.1:38886`. BB has no client auth, so the tailnet is the boundary.
On first run, with no server saved, the app asks for the URL before anything
else. You can change the server in Settings.

A build can carry a default server: set `BB_DEFAULT_SERVER_URL` in the
environment of `scripts/testflight.sh` or `scripts/device.sh` (for example in
`~/.config/bbgo/testflight.env`, which `testflight.sh` reads). It lands in each
target's `Info.plist` as `BBDefaultServerURL`. The committed default is empty. After a switch, the app registers its push token with the new server at once, without a relaunch.

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

### Testing

No test runs past five minutes. Every UI test class inherits
`ServerIsolatedUITestCase`, which sets XCTest's `executionTimeAllowance` to
its `timeLimit` (300 s) and starts a watchdog that stops the test runner 15 s
after it, for a run without timeouts on (Xcode's test button, a bare
`xcodebuild`). Every script runs with `-test-timeouts-enabled YES
-default-test-execution-time-allowance 300
-maximum-test-execution-time-allowance 300`, so XCTest fails the test first
and records a spindump; pass them to a direct `xcodebuild test` too.
`scripts/check-test-timeouts.py` (a build phase) fails the build when a UI
test class skips the base class or its `setUp`, sets its own allowance, or a
script runs tests without the flags.

The `BBStudio` scheme tests in Debug (unit and UI tests). The
`BBStudioUITests` scheme holds the UI tests alone, for a Release build: the
unit tests need Debug's testability. `scripts/test-release-launch.sh` runs
`LaunchStackUITests` on a Release build, where the launch crash of TestFlight
20261126.0313 happened: an isolated staged BB's Bot and one of its threads
open by deep link (no Debug demo) on the device's 1 MB main stack. Run it
before every TestFlight upload.

`ShellUITests` checks the app shell offline (`-qaSpacesDemo list -qaBotDemo
chat -qaWorkbenchDemo`): on the iPhone, Home as the root with the tab bar
(Home, Library, Memory, Search), the Search tab, the conversation's native bar
(the system's Back, the Workbench button with its tab count, ⋯, no Live), the
flip by button and by a sideways swipe with the composer kept, the tab menu
(pick, Close), and the More menu; on the iPhone Duo simulator, folded (the
bar's buttons and the tab bar in the right column the system reserves, every
tab), pushed pages and designs under their native bars, book (conversation |
Workbench, Home on request), flat (Memory's two pages) and vertical (one
column). With `TEST_RUNNER_SHELL_CAPTURE=1`, `qa-duo/capture` keeps each
posture's window PNG in the app's Documents.

Rows are tighter on every phone: 10 pt apart, 20 pt Worked rows, a sent
photo 160 pt, and a 120 × 72 tile while it loads (one shared download per
photo, a thumbnail at the size shown, a retry after 30 s). Offline,
`DuoSpaceCaptureUITests` (`-qaBotDemo chat -qaDuoSpace`: a photo with a long
message, two steps and a reply) checks all of it on the Duo and an iPhone:
the composer's resting edge, one row until focused, no Worked row over your
message (photo arriving late, scrolling up to it), and the column's back.
`TEST_RUNNER_DUO_SPACE_OUT` keeps its PNGs and measured frames;
`TEST_RUNNER_DUO_SPACE_IMAGE` serves the photo from a local fixture server.

Set `STAGED_SERVER_URL` in the examples below to your isolated staged BB's URL.
Server-backed UI tests require `TEST_RUNNER_BBGO_QA_SERVER` to name an isolated
staged BB (`BBGO_QA_SERVER` inside the test runner). Without it, those tests skip
before launching the app or sending requests. There is no default BB server.
Their launches, relaunches, and API/RPC helpers use that same staged origin.
Never point this variable at your personal BB.

Offline demo tests run without the variable. This includes the transcript,
keyboard, Duo layout, draft attachment and scroll log fixtures.
`launchOffline()` pins them to `https://offline-fixtures.invalid`, even when a
QA variable or saved server is present. They never use the staged or personal
BB. Mixed suites gate only their server-backed test methods.

The Xcode build runs `scripts/check-test-servers.py` before tests. It rejects
hard-coded server ports in `Tests` and `UITests`, direct app launches that
bypass the isolated launch helpers, and UI classes that bypass the shared
server helpers. Run it directly with `python3 scripts/check-test-servers.py`.
Unit tests keep reserved `.invalid` and `.test` URLs for mock transports.
The optional `ComposerTests.testLivePluginInputsReachHandlers` unit test also
requires the QA server variable; the old `BBGO_LIVE_RPC` opt-in is no longer used.
The Share runtime helper uses the same QA variable. Additional fixture IDs and
private-simulator opt-ins still apply to tests that need them.

UI tests click through Home and a thread (reaction chips, paste, the message
menu, quoting, and jump-to-latest). Use a throwaway thread on the staged BB
whose newest reply ends with a `::reactions` line:

```sh
TEST_RUNNER_BBGO_QA_SERVER="$STAGED_SERVER_URL" TEST_RUNNER_BBGO_QA_THREAD=thr_xxx xcodebuild test -scheme BBStudio \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro' -only-testing:BBStudioUITests
```

`testProbe` screenshots any thread while scrolling up through it, without
changing anything: `TEST_RUNNER_BBGO_PROBE_THREAD=thr_xxx`, plus optionally
`TEST_RUNNER_BBGO_PROBE_SWIPES=<n>`, `TEST_RUNNER_BBGO_PROBE_FAST=1`, and
`TEST_RUNNER_BBGO_PROBE_FIND=<text>` to stop once that text is on screen.
Screenshots land in `/tmp/qa-ui-probe-*.png`.

`ComposerUITests.testMicTapDictatesInline` taps the mic in New thread against a
server with Studio (`TEST_RUNNER_BBGO_QA_SERVER=http://127.0.0.1:<port>`, for
example a staged BB; nothing is sent): Listening with ✓ and ✕, ✕ restoring
what was typed, and ✓ leaving the result in the field
(`/tmp/qa-composer-dictation.png`).

`MiniAppUITests` opens a mini app on a staged BB
(`TEST_RUNNER_BBGO_QA_MINI=mini_…`) whose app has "Add task", "Count <n>" and
"Fetch" buttons: Add task writes a record through the phone's relay, Count
saves shared state, and Fetch shows the phone's refusal
(`/tmp/qa-mini-*.png`).

`MiniCardUITests` runs mini apps in reply cards on a staged BB
(`TEST_RUNNER_BBGO_QA_MINI_THREAD=thr_…`). The thread's newest reply holds, in
order, `::mini` cards for the app above ("Add task", "Count <n>", "Fetch"), a
"Long list" app taller than its card (rows "Row 1"…, `size.maxHeight` below the
rows' height), a note app ("Tap note", "Note taps: <n>") and the first app
again. It uses the last card, drags over it to scroll the thread, scrolls the
long list inside its card without moving the thread, taps the note, and checks
that the first copy shows the shared count and new record. It then writes
`/tmp/qa-mini-cards-ready` and waits up to a minute for a record titled
"Server task" in the first app, which you insert through `minis.db.insert` on
the staged server, to arrive by realtime (`/tmp/qa-mini-cards-*.png`).

For deterministic Duo testing without an agent-produced reply, additionally set
`TEST_RUNNER_BBGO_QA_SERVER` to the isolated staged server and
`TEST_RUNNER_BBGO_QA_MINI_IDS` to three comma-separated mini IDs: the task counter,
long list, and note, in that order. Set `TEST_RUNNER_BBGO_QA_MINI_THREAD=thr_botdemo01`.
The Debug-only `-qaDuoMinis` fixture renders those real apps in local reply rows;
records, shared state, frames and realtime still use the staged server. In this
mode the full card test inserts its own external “Server task” record through
RPC. `testScrollOwnershipInOuterAndLandscape` uses the same fixtures in exact
466 × 678 and 951 × 669 windows on an owned 13-inch iPad simulator.

`ConversationsUITests` checks a Bot's conversations offline (`-qaSpacesDemo
needs|list` with `-qaBotDemo chat`, answered by `BotSpacesDemo.State`): Reply in
thread → sheet → the replies row, reopening a thread from its row, Fork into its
own conversation under Main, the model chip, ··· → Model and Finish, the workers
line, New conversation, and Quiet check. `TEST_RUNNER_STEP5_OUT` keeps its PNGs.

`WorkersUITests` opens workers offline (`-qaSpacesDemo needs` with `-qaBotDemo
chat`; `BotSpacesDemo.State` answers `bot_thread_info` and `bot_worker_ask`):
a failed worker from the list's "N done", Ask landing in Launch prep, a
running worker from the workers line with Ask going back to Main, and a worker
waiting on an approval showing its status only. `TEST_RUNNER_STEP6_OUT` keeps
its PNGs.

`NewConversationUITests` checks New conversation offline (`-qaConversationHome
-qaSpacesDemo list -qaBotDemo chat`): who it's with, the Bot, project,
workspace and model chips, starting on a picked model, another Bot on its Auto
default, No Bot as a plain thread in a project, and the Bot switcher on the
list's header, Send hittable above the keyboard with 3 lines and blanks, 15
and 60 lines at large text and the default, turned sideways and on the
vertical Duo, and the draft kept across Back, another tab and a relaunch
(`-qaKeepDrafts`), as a conversation's is; with `TEST_RUNNER_ROUND2_DUO=1` on
the iPhone Duo simulator, the folded Duo's ↓ and the unfolded Duo's left side.
`TEST_RUNNER_ROUND2_OUT` keeps PNGs.

`DesignZoomUITests` checks a design's player offline (`-qaDesignDemo`: one
design with a desktop and a phone screen whose pages say `user-scalable=no`):
each opens painted at fit-to-width with no touch (bright pixels in the still),
a pinch zooms, a pan keeps the zoom and the still in place, a double tap and a
pinch out go back to fit and no smaller, a tap plays the live page, and a pinch
on a thumbnail opens it. On the iPhone and the folded Duo.
`TEST_RUNNER_ROUND2_OUT` keeps PNGs.

`RouterGatewayUITests` checks the router's usage-limit notice with Hand off
(`-qaRouterDemo`) and the Tool Gateway in Settings, offline.
`TEST_RUNNER_ROUTER_OUT` keeps PNGs.

`BotControlsUITests` checks the Bot's controls offline (`-qaConversationHome
-qaSpacesDemo list -qaBotDemo chat`): Pause from the list's header, the paused
line with Resume in the conversation, and Make this the Main from a
conversation's ⋯. `TEST_RUNNER_CONTROLS_OUT` keeps PNGs.

`DuoAuditUITests` (`TEST_RUNNER_DUO_AUDIT_DIR=<dir>` on an iPhone Duo
simulator) walks the menu, each place, Settings, a conversation, its ⋯ menu,
the composer, attachments, a worker and a Library item through folded,
landscape, the right page, portrait and folded again. At each step it writes
`<dir>/req/<name>` and waits for `<dir>/done/<name>`, so a script outside the
simulator can take a real `simctl io … screenshot --display=primary` (with the
system's right column) into `<dir>/out`. `ConversationRemoveUITests` covers Archive, Delete,
Restore and the Main and working-conversation guards offline.

`BotPagesUITests` opens each Bot page from the room's menu offline
(`-qaSpacesDemo list` with `-qaBotDemo chat`; `BotSpacesDemo.State` answers
`memory.*`, `bot_library`, `bot_threads_older`, `bot_finished` and
`bot_reopen`, and `-qaStrandsDemo` answers Strands): Memory's profile, topic
filter, a record's edit and a new record; Library's groups, folding, Kind
filter and a design opening; Strands and Automations; Archive's Failed filter,
a finished conversation's summary, and Reopen bringing it back to the list.
It also covers a slow network: `-qaDemoPageLatency <ms>` delays `memory.*`,
`bot_library` and `bot_threads_older`; `-qaDemoCachedBot` starts from a
cached Bot list whose Bot has an older id, then swaps in the loaded one while
the first page is loading. `-qaDemoPageFail memory,library` fails each of
those calls once, so the page shows its error with Retry. Each page loads
through `PageLoad` (`iOS/Bot/PageLoad.swift`). The load is keyed by server
and Bot, it is not cancelled when the view is rebuilt, and it retries a
cancellation it didn't ask for. It ends loaded or with an error, never
spinning. `TEST_RUNNER_STEP8_OUT` keeps its PNGs.

`ApprovalsUITests` checks worker approvals offline (`-qaSpacesDemo needs` with
`-qaBotDemo chat`; `BotSpacesDemo.State` answers `bot_conversation_approvals`
and `bot_worker_approval_resolve`): the card in Main, Approve settling it and
the worker running again, and the waiting worker's marker opening Main.
`-qaNoDemoApprovals` leaves the card out (`ConversationsUITests`).
`TEST_RUNNER_STEP7_OUT` keeps its PNGs.

`LinksUITests` opens `bbstudio://` links offline in the Bot's list
(`-qaSpacesDemo list`; `BotSpacesDemo.State` answers `links.resolve`): a Bot
page, a worker, a memory record, and a conversation that's gone ("Not
found"). `TEST_RUNNER_STEP9_OUT` keeps its PNGs.

`StudioPagingUITests` swipes Studio between its kinds and drags an item row
partway open (`/tmp/qa-studio-paging-*.png`).

The Duo UI tests (`Duo*UITests`, `HeaderTapUITests`, `TranscriptTapDismissUITests`)
run on an iPhone Duo simulator, which needs the iOS 27.1 runtime; the Duo isn't
offered on 27.0. `simctl io … screenshot` on it needs `--display=primary`.

Unit tests use a private simulator clone:

```sh
export BB_TEST_SIMULATOR_ID=<your-private-simulator-id>
scripts/test.sh -skip-testing:BBStudioTests/TranscriptReplayTests/testReplayOnTheDuoOuterScreen
```

That replay hangs on iOS 27.0, so runs skip it.

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
   cd ../plugins/packages/bb-studio-mobile && npm install && bb plugin build && bb plugin install .
   bb plugin config mobile set apnsKey "$(cat ~/path/to/AuthKey_XXXXXXXXXX.p8)"
   bb plugin config mobile set apnsKeyId XXXXXXXXXX
   bb mobile status
   ```
3. **Route BB pushes through the relay**. This changes the push-notifications
   plugin, and non-APNs tokens still reach Expo:
   ```sh
   bbs plugin config push-notifications set expoPushUrl \
     "${BB_SERVER_URL:-http://127.0.0.1:38986}/api/v1/plugins/mobile/http/push?token=$(bbs plugin token mobile)"
   ```
   BB Studio's server is on 38986; stock bb's server is a different one.
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
   Upload only when the owner asks for a build: batch changes into one upload,
   not one per commit. Apple caps uploads per day, and each build means a new
   install. To try a change on the phone meanwhile, use the Debug install above.
   Internal testers (you) get builds without App Review. TestFlight builds use
   production APNs, so the APNs key must be enabled for **Sandbox & Production**.
