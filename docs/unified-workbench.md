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
leaving an outer parent draft untouched. Publishing that core commit awaits
resolution of an older uncommitted channel-workbench change in the shared
BB checkout; its owner's thread is archived. Stable plugin floors stay
unchanged, and stable BB still uses the guarded Viewing chip until that host
fix ships.

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
Existing page chats and the `pages:<id>` draft key remain in use. Pages' 80
tests pass, including continuation, project/context forwarding, error retries,
and stale submissions. The stable BB 0.44.0 standalone captures at pushed
commit b070150 pass with Studio Chat temporarily disabled: the actual legacy
page chat continues without duplication, a draft survives closing and
reopening, and the phone drawer keeps all composer buttons in the viewport.
The scheduled fixture never runs an agent. Studio Chat is restored and the
fixture thread/pages are deleted after capture.
The phone page header is still crowded; the remaining compact-layout audit
must cover item-header navigation and overflow menus across the suite, beyond
the verified conversation drawer.

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

Remaining delivery includes native host live verification and release,
the SDK/CLI placement controller, embedded composer
targeting, all suite entry points, compact behavior,
staged live captures, documentation and marketplace checks, and the
requirement-by-requirement completion audit. This goal stays active
until those workflows are implemented and verified.
