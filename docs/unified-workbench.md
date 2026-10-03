# Unified Studio workbench

The active delivery goal covers the entire Studio suite. A conversation is
a BB thread. A companion is a tab showing a thread or plugin view. The same
companion stack can dock in BB's right workbench or float; an individual tab
can open in the main view. Placement does not create another conversation.

## Required behavior

- Every Studio item has one primary Chat action. It opens the linked thread
  or a new-conversation composer. New conversation and Choose conversation
  are explicit secondary actions.
- Item quotes and context use that same thread and its composer. The item
  being viewed and the context actually sent to the agent stay distinct.
- All suite entry points use the same target identity, placement policy,
  tab selection, and restoration. Opening an existing target focuses it.
- Moving between docked, floating, and main presentations preserves drafts,
  attachments, scroll position, and editor state. Switching, folding, and
  hiding companions also preserves their state.
- Pinned companions stay while navigating other items. Closing or dismissing
  the panel stays respected until an explicit user action opens it.
- Pages' separate chat card and Float-specific Studio Chat actions migrate
  to the common experience. Existing threads and item links carry over.
- Browser and terminal tools stay available in the native workbench.
- Every plugin installs on stable BB. Required host contracts must ship
  with corresponding integration verification, rather than relying on a
  nightly-only SDK or an empty panel that happens to render.

## Coverage

| Plugin | Integration to verify |
| --- | --- |
| Studio | Collection, spaces, item tabs, Home, menus, and drag targets |
| Studio Chat | Item links, creation, picking, quotes, composer context |
| Float | Shared tabs, docking, floating, pinning, dismissal, restoration |
| Pages | Editor, comments, existing page chats, embeds, standalone fallback |
| Talk | Recording, dictation, transcript quotes, playback continuity |
| Draw | Drawing editor, live changes, opening references beside it |
| Artifacts | Text, image, file, and HTML viewers; selections and quotes |
| Tables | Tables, views, cells that link Studio items, editing continuity |
| Tasks | Boards, tasks, linked items, agent handoff |
| Teams | Bot profiles, conversations, saved views, thread entry points |
| Feed | Item and thread links from posts |
| Explore | Explainer panels and links to pages |
| Sidebar | Thread and Studio navigation, row menus, split actions |
| Navigation | Quick Open and keyboard placement actions |
| Reactions | Message actions target the displayed thread |
| Decisions | Shared composer and busy-thread routing remain correct |
| Mobile | Existing thread/item links and compact presentation |

## Current evidence and remaining work

The original stable BB 0.44.0 captures use SDK 0.5.29. The latest compatibility
check reports stable BB 0.45.0 with SDK 0.6.15 and passes for all 18 packages,
including the shared kit, without raising their pins. SDK 0.5.29 exposes owner-scoped fixed
tabs on plugin pages and thread-scoped panel actions. A general, movable
companion stack needs further host integration; the current API alone does
not prove the requested experience.

The first implementation retains realized Float views through tab switches,
folding, and hiding, adds persistent pins, and restores validated back history.
Regression tests exercise native draft and attachment retention, local editor
state and scroll, lazy realization and disposal, background item changes,
duplicate destination focusing, and pin protection during tab-limit trimming
and reload. The staged Float capture passes on stable BB 0.44.0 installed
from the pushed repository commit: a page, drawing, and thread open through
their actual sidebar menus. It verifies retained Pages and SDK composer DOM
identity and an unsent draft through switching, folding, hiding, and moving
Float, plus the persisted pin. The screenshot is Float's staged preview.
This verifies Float's current bottom/free placements; right-workbench and
main-view transfers and full suite verification remain required.

Float's capture uses deterministic page and drawing fixtures and does not
depend on generated Teams or Explore replies. The first staging run failed
on malformed Explore fixture output after installing the suite; the Float
capture reused the verified running staged server and its existing Orbit
project and thread. Its live assertions were not relaxed.

The shared item header now offers Chat, New conversation, Choose conversation,
and Unlink. Studio Chat resolves actions by explicit item identity, including
companion items. Its composer and picker keep that subject during main-pane
navigation. Tests cover linking, quotes, project selection, missing or archived
items, overlapping requests and submissions, failed drafts, and fallback
thread navigation. Teams saved views remain free of item-chat overlays and
automatic background chat discovery. The old corner bar is removed.
Targeted staging installs the full suite while seeding only the selected
capture's required fixtures. Stable BB 0.44.0 captures pass with the full suite
installed from pushed commit e7ed8a3: Chat opens an unlinked composer, chooses
and focuses a linked thread without duplication, starts another composer
without changing the link, and targets a floated page while the main pane
navigates between a drawing and another page. Float's retention and pin
assertions also pass. Screenshot review identified crowded narrow headers;
the shared header now delegates Back to the companion chrome, uses a compact
Related action, and removes Pages' duplicate floated breadcrumb. The final
stable capture verifies every visible page-header button stays within the
400px companion body. Both staged previews are visually checked.

BB core commit f865c4e38 locally scopes embedded chat leading content to its
own bottom composer and composer view. Its 18 embedded-chat tests and app
typecheck pass, including a regression that writes to the child draft while
leaving an outer parent draft untouched. That fix is now adapted to current
BB source in `1050e72f3`; its 19 embedded chat tests and app/SDK typechecks
pass. The isolated checkout preserves the older shared checkout's unrelated
edits. Stable plugin floors stay unchanged, and stable BB still uses the
guarded Viewing chip until that host fix ships.

The next host implementation adds `experimental_CompanionView` and
`experimental_CompanionOutlet`. An overlay owns one persistent portal;
the native workbench merges its tabs into the existing Browser/Terminal strip
and a main outlet receives the same DOM. App and SDK typechecks pass, and
60 relevant app tests pass across the host checks. New regression tests cover editor DOM, draft,
file input, local state, scroll, route transfer, native tab selection,
dismissal, explicit reactivation, pin protection, disposal, and plugin
identity/CSS scoping. Native header/keyboard dismissal and session restoration
also pass; SDK tests pass (359). This host change is local and has not shipped.

The suite's optional bridge retains stable SDK pins. Shared Chat prefers
workbench on a capable host; explicit Float actions keep floating placement.
The persisted tab model now carries placement and explicit activation;
moving a tab preserves identity, history and pin, and reopening an existing
main companion focuses it without relocating it. The Companions nav panel
receives a retained main view. Plugin-owned item portals update compact/main
context without unmounting their editor. Focused checks pass: Float 37,
shared kit 70, and Studio Chat 22 tests. The repeatable `float-native` live
capture now passes against the local BB frontend and an isolated stable
server. The full suite is installed at pushed commit 41b329c, with Float at
8a57c1c. It checks the real Pages editor, SDK composer, unsent draft, file
attachment, and pin through Float/workbench/main transfers. The native
capture exposed and fixed double-encoded main routes and a development proxy
that did not forward plugin sync sockets. Host release remains required.

Pages' standalone header now uses Chat and New conversation. Its former chat
card is removed; legacy page chat routes and activity entries open the shared
companion destination, with ordinary thread navigation when Float is absent.
Existing page chats and the `pages:<id>` draft key remain in use. Pages' 84
tests pass, including continuation, project/context forwarding, error retries,
and stale submissions. The stable BB 0.44.0 standalone captures at pushed
commit b070150 pass with Studio Chat temporarily disabled: the actual legacy
page chat continues without duplication, a draft survives closing and
reopening, and the phone drawer keeps all composer buttons in the viewport.
The scheduled fixture never runs an agent. Studio Chat is restored and the
fixture thread/pages are deleted after capture.
The updated stable BB 0.45.0 standalone captures install Pages `1992412`,
save a draft and file in its old dialog, then install `258d801` and restore
them in the canonical companion composer. They verify exact composer DOM
retention through folding, tab reuse, and real sidebar navigation, plus draft
and file recovery after reload. A second page's native scheduled send retains
the page pointer, edited prompt, and attachment, replaces its originating tab,
and updates the main page's Chat action to reuse the created conversation.
The phone companion keeps all composer controls inside a 390 by 844 viewport.
The [desktop](../packages/bb-studio-pages/assets/standalone-chat.png) and
[phone](../packages/bb-studio-pages/assets/standalone-chat-mobile.png) screenshots
are visually checked. All scheduled threads and seeded pages are deleted.

Teams now registers companion renderers for bot profiles, saved views, and
legacy channel routes. Bot Chat resumes its direct conversation; New
conversation is separate. Saved-view and profile thread entry points use
the shared companion policy. Kinds with `hasOwnChat: true` opt out of
automatic Studio Chat discovery while keeping explicit mention context.
Headers can supply their own `chatAction`. Companion navigation now has an
explicit context for asynchronous saves and legacy redirects, so it does
not depend on a transient click event.

The full suite check passes after pushed commit adc6638: typechecks, all
plugin tests, stable BB 0.45.0 compatibility, contracts, marketplace,
screenshots, and the shared kit archive. Teams has 92 tests, the kit 73,
and Studio Chat 23. Its repeatable `bots-companions` capture on stable BB
0.45.0 verifies the saved view's exact composer DOM, draft, and file
attachment through tab switching and folding, conversation reuse without
duplication, and retained title/member controls. The screenshot is visually
checked. This extends stable Float coverage; native host release is still
required.

The shared header now keeps Chat visible at narrow widths and groups secondary
controls under Item actions. Its controls stay mounted through closing,
resizing, and placement changes. Task boards use the same header, with a
canonical board identity for Chat and the current Board/List/Calendar route
for placement. Related uses a viewport-bounded popover and binds navigation
to the companion that opened it, including portal-rendered links.

The compact-layout implementation and capture definitions are pushed in
715a380, 7cd7050, and 786fd2f. The full suite check passes; the kit has 76 tests.
Live captures on stable BB 0.45.0, with all 17 plugins installed from 786fd2f,
pass for [Pages](../packages/bb-studio-pages/assets/compact-header.png),
[Draw](../packages/bb-studio-draw/assets/compact-header.png),
[Artifacts](../packages/bb-studio-artifacts/assets/compact-header.png),
[Talk](../packages/bb-studio-talk/assets/compact-header.png),
[Tables](../packages/bb-studio-tables/assets/compact-header.png),
[Tasks](../packages/bb-studio-tasks/assets/compact-header.png), and
[Teams](../packages/bb-studio-teams/assets/compact-header.png).
Each checks the primary Chat action, every visible header button's bounds
and hit target, page overflow, and the Related popover at 390 by 844 pixels.
Visual review caught Tables' sticky grid header covering Export and More;
the corrected layering passes both the hit checks and final screenshot review.
All seven captures are visually checked, with seeded fixtures removed.

Explore now registers shared companion views for its explainers and lists.
Finding rows and the thread launcher use that policy; the legacy thread panel
remains available without Float. Open in Pages now targets Pages rather than
the owner-only SDK panel route. Its 67 tests and typecheck pass. The repeatable
stable BB 0.45.0 [companion capture](../packages/bb-studio-explore/assets/companion-preview.png)
uses Explore from pushed 6d900de with the suite installed from 786fd2f. Seeded
writing/ready job states verify both list routes, progress becoming the saved
document, destination reuse, exact iframe and scroll retention after switching
to Pages and back, and the persisted pin. No worker runs. The live check caught
an undefined RPC field in the new list and also verifies the running list
refreshes if it misses the completion event.

Task handoff confirmations, bot handoffs, current and earlier handoffs, and
linked threads now use the shared companion policy in pushed commit 6854481.
Tasks' 49 tests and typecheck pass. The stable BB 0.45.0 capture, with Tasks
installed from `258d801`, now checks the current handoff, earlier handoff and
linked discussion from the real task page. It verifies one companion per
destination, the unchanged main task, and exact reply draft/attachment DOM
retention after returning and folding. The
[desktop](../packages/bb-studio-tasks/assets/companion-handoffs.png) and
[phone](../packages/bb-studio-tasks/assets/companion-handoffs-mobile.png)
screenshots are visually checked; all phone composer controls fit at 390 by
844 pixels. Deterministic handoff rows and scheduled threads seed the workflow;
all fixtures are deleted without running agents.
The separate live dispatch check installs Tasks `6bec6a4` on stable BB 0.45.0.
It creates an agent handoff through the real project-folder picker and edited
note, then opens its confirmation and returns to the exact native reply draft
and attachment. A temporary bot receives another task; after its conversation
and link are renamed, a second Send to bot request returns that same thread.
Both actual RPC responses succeed, with one handoff and one retained tab.
The created conversations contain their task context and the agent's edited
note. This exposed two fixed bugs: a missing host ID during ordinary handoff,
and bot reuse depending on a mutable human link label. All 60 Tasks tests,
typecheck and build pass. The
[dispatch screenshot](../packages/bb-studio-tasks/assets/companion-dispatch.png)
is visually checked. Brief fixture agent turns run; cleanup deletes their
tasks, board and threads and retires the temporary bot.

Studio Chat's new-conversation composers now have shared companion routes.
Ordinary item drafts retain their native draft keys; independent quote drafts
store their passage and image in IndexedDB before opening. The originating
tab becomes the new thread after submission. Studio Chat's tests verify
draft and attachment DOM retention through placement changes, independent
quote restoration, image forwarding, failed submissions, storage failures,
and background submissions that leave another draft intact. Its 38 tests,
typecheck, build, and stable compatibility check pass. The live capture on
stable BB 0.45.0 installs the suite from 5f570e3, Chat from 30a10aa, and
Artifacts from 902d642.
It verifies conversation linking/reuse, exact native composer and attachment
retention through real sidebar navigation, a second item draft and folding,
and a cropped image quote whose image, edited prompt, and file attachment
return after a browser reload. The [screenshot](../packages/bb-studio-chat/assets/staged-preview.png)
is visually checked. The workflow caught and fixed a server-only SDK import
in the frontend and a quote card whose controls were behind Float. Artifacts'
53 tests, typecheck, and build pass; the capture verifies the quote controls'
actual click targets. No agent runs.
The updated capture on stable BB 0.45.0, with Chat installed from `258d801`,
also checks the recovered image quote at 390 by 844 pixels. Its crop, edited
prompt and attachment remain intact, resizing retains the exact native
composer, and every visible composer button and image stays in the viewport
with an unobstructed hit target. The
[phone screenshot](../packages/bb-studio-chat/assets/quote-mobile.png) is
visually checked. The capture now waits for the new document after reload,
preventing an old composer from satisfying the recovery assertion.

Feed discussions now use the shared new-conversation composer and a canonical
post-specific companion route. Source threads, post pages, linked items and
asynchronous Explore results use the same navigation policy, including routing
back into the companion that initiated a request. The shared kit has 78 tests,
Feed 18, Studio Chat 38 and Pages 80; their typechecks and affected builds pass.
The stable BB 0.45.0 capture installs the suite from `96c12b9` and Feed from
`e02c49a` and Float from `b97c557`. It checks exact native draft/attachment retention through folding,
tab reuse, linked-page opening and real sidebar navigation, plus compact
composer bounds at 390 by 844 pixels. Native scheduled send creates a discussion
in its originating tab, with the post pointer, edited prompt and file retained
in BB's queued message. The phone check caught docked Float's desktop right
margin clipping the left edge of a resized companion. Float now bounds that
margin to the available viewport width. All seeded fixtures are deleted
without running agents.

Float's drag overlay now clears after consumed drops, cancelled drags, window
blur, and a removed source that loses `dragend`. Cleanup waits until the drop
event finishes so React can open the companion before its target disappears.
All 45 Float tests pass, including a regression that fails with immediate
capture-phase cleanup. The stable BB 0.45.0 [drag capture](../packages/bb-studio-float/assets/drag-preview.png)
uses real mouse input to verify Escape cancellation, a successful drop into
exactly one page tab, and removal of the drop zone in both cases.

Talk now binds its microphone to the actual displayed composer, rather than
the main thread. Thread companions keep their thread identity; new-conversation
companions keep their canonical route and selected project. Go back focuses
that same tab, and finished dictation waits until its originating composer
returns. Talk's 127 tests, typecheck and build pass. The stable BB 0.45.0
capture uses source `b52d193` with the compact-controls fix `fb4ca80`. It checks
the saved recording's thread/project, exact native draft and attachment DOM,
one tab per destination, and an unchanged main page after both return flows.
The [desktop](../packages/bb-studio-talk/assets/companion-dictation.png) and
[phone](../packages/bb-studio-talk/assets/companion-dictation-mobile.png)
screenshots are visually checked. At 390 by 844 pixels, every visible Talk
control stays inside the viewport; clipped inline controls fall back to the
floating pill. All staged recordings, threads and pages are removed without
running an agent. Recovery links also follow their originating companion;
live recovery-list and interrupted-recording checks remain required.

Remaining delivery includes publishing the native host, its SDK/CLI
placement controller and embedded composer fix, and the remaining suite
entry points: Talk recovery navigation and playback
continuity, and split/swap actions. Initial main-view-to-companion transfer
must also prove retention of an already-open editor's unsaved state; the
existing native capture verifies transfers after the companion is realized.
The requirement-by-requirement completion audit and final release checks
remain required. This goal stays active until those workflows are implemented
and verified.

The host implementation is now adapted to authoritative BB `32efd2e3f` in an
isolated checkout. Its SDK/CLI placement controller is implemented in
`24d2201fc`. App, server, CLI and SDK types pass; native panel checks have 77
passing tests, embedded chat 19, CLI/guide 5, server/SDK delivery 1, core SDK
109, Plugin SDK 362 and Plugin Guide 75. The normal optimized BB build passes
50 tasks and runs in a fresh data directory with all 17 plugins installed
from pushed `ba0ae10`, then Float `f962c2c`. The updated
[native capture](../packages/bb-studio-float/assets/native-workbench-preview.png)
verifies exact editor/composer DOM, draft and attachment retention through
UI and actual CLI placement changes, pin-protected close, saved placement,
and focusing a retained main conversation after another main view opens.
The [reviewable core patch](host-support/native-companions/README.md) includes
the native host, SDK/CLI controller, and current embedded-composer fix.
The account has `READ` permission on `get-bb/bb`, so host publication remains
an external requirement. Stable plugins continue to detect the optional
capability without raising their SDK pins. Initial main-editor retention,
split/swap flows, and the full completion audit remain required.


Main plugin panels now register with their own app overlay through Kit's
`retainPanel(path, Component)` wrapper. Pages, Talk, Draw, Artifacts, Tasks,
Tables, Feed, Explore, Studio Chat, Studio, and Teams use it for every content
route. The overlay owns a stable portal container before Float opens. The
first companion move carries that container rather than creating another
editor. Separate main panes retain independent state; the most recently
focused pane supplies the companion. A main route showing the moved item
provides a Show companion action. Closing its companion returns the same
view to an available main pane; ordinary navigation without a companion
disposes the view. If no renderer is registered, the panel renders inline.

Seven regression checks cover original editor/file-input identity, local state,
focus, selection, scroll, main-route changes, two panes of the same document,
asynchronous navigation context, and fallback/disposal. The header regression leaves the main route before
the companion body registers; a bounded pending transfer retains its owner
through that interval. Kit has 92 passing tests. Full suite checks, builds,
stable compatibility, contracts, marketplace, documentation, and the
refreshed Kit pack pass. Native main-thread composer adoption and split/swap
still require verification.


Live first-move evidence now passes. Both isolated BB stages install all 17
plugins from pushed `b241546`, with Pages and Float updated to `75ad5f5`.
The stable desktop capture records the Pages editor and drawing canvas in
the main view before their first Float move and verifies the exact original
nodes. The [390px header capture](../packages/bb-studio-float/assets/first-main-transfer-mobile.png)
uses the real Move → Float this action, leaves the main route, and verifies
one original editor with its inserted text in a companion that fits the
viewport. The current native BB capture records and edits the main editor
before Float, then checks the same node through UI and CLI placement changes,
including pin-protected close and returning to a main companion. All three
screenshots are visually checked. No agent runs for these fixtures.


The native Float menu now opens Move to split through the retained Companions
outlet instead of closing and recreating the tab. Swap resolves a main
Companions route to its actual item and exchanges the two tabs' placements.
Both targets keep their original pins and navigation history, and an existing
destination is reused. Float's menu lists companions in every placement,
while its tab strip shows floating tabs. Float's 50 tests, types, build, and
stable compatibility pass; live split/swap proof and legacy-host transfers
remain required.
