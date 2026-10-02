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

Stable BB 0.44.0 ships SDK 0.5.29. The compatibility check passes for all 18
packages, including the shared kit. That SDK exposes owner-scoped fixed
tabs on plugin pages and thread-scoped panel actions. A general, movable
companion stack needs further host integration; the current API alone does
not prove the requested experience.

The first implementation retains realized Float views through tab switches,
folding, and hiding, adds persistent pins, and restores validated back history.
Regression tests exercise native draft and attachment retention, local editor
state and scroll, lazy realization and disposal, background item changes,
duplicate destination focusing, and pin protection during tab-limit trimming
and reload. Live suite verification remains required.

Remaining delivery includes the common opening and placement controller,
native workbench integration, the single Chat action, Pages migration,
composer targeting, main-view transfers, all suite entry points, compact
behavior, staged live captures, documentation and marketplace checks, and
the requirement-by-requirement completion audit. This goal stays active
until those workflows are implemented and verified.
