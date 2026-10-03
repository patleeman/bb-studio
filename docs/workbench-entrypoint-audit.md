# Studio workbench entry-point audit

This checkpoint covers all 17 marketplace plugins and the shared Kit. Source
coverage and live evidence are listed separately. The delivery goal remains
active: the native companion host has not shipped in stable BB.

## Shared ownership and identity

Kit's `item-header.tsx` and `item-chat.ts` provide the item Chat action.
`companion.tsx` chooses the native workbench when available and Float otherwise.
Float's stack uses canonical thread/path keys, shared placement, explicit
activation and persistent pins. Reopening a target focuses its existing tab.

Eleven content plugins register `retainPanel` and matching `FloatPanels`:
Studio, Studio Chat, Pages, Talk, Draw, Artifacts, Tasks, Tables, Feed, Explore
and Teams. Teams covers `bots`, `channels` and the legacy `views` redirect.
Their app overlays own the original views before the first companion move.
Sidebar and Navigation supply entry points. Reactions and Decisions act on the
existing conversation; Mobile supplies native links and delivery rather than
another desktop chat panel.

## Suite entry points

| Plugin | Source integration | Recorded live evidence |
| --- | --- | --- |
| Studio | Item/sidebar menus, shared item headers, Quick Open placement and retained collection/space routes | [Compact headers and New menu](../packages/bb-studio/README.md) |
| Studio Chat | One Chat action, linked conversation, creation/picking, item-specific quotes and retained composer routes | [Draft/file/image quote and phone recovery](../packages/bb-studio-chat/README.md) |
| Float | Canonical stack, pins/history, explicit Float/main/split/swap; optional native workbench | [Stable and native transfers](../packages/bb-studio-float/README.md) |
| Pages | Shared Chat; standalone fallback and legacy chat-route migration; original editor ownership | [Standalone migration and compact controls](../packages/bb-studio-pages/README.md) |
| Talk | Retained recording/player routes; dictation and Go back target the originating composer | [Exact draft/file return and playback continuity](../packages/bb-studio-talk/README.md) |
| Draw | Retained canvas, shared item Chat and companion-aware related references | [Original first-move canvas and compact header](../packages/bb-studio-draw/README.md) |
| Artifacts | Retained viewer, text/image/HTML quotes through shared Chat | [Viewer/quote formats and compact controls](../packages/bb-studio-artifacts/README.md) |
| Tables | Retained table/view route, shared header and canonical item references | [Compact header, real editing/import and bounded rendering](../packages/bb-studio-tables/README.md) |
| Tasks | Shared task/board header; current/earlier handoffs, discussions and dispatch use companions | [Retained handoff composer and real bot dispatch](../packages/bb-studio-tasks/README.md) |
| Teams | Bot Chat, channels and member-thread entry points; `hasOwnChat` suppresses redundant automatic item chat | [Channel composer/file retention and conversation reuse](../packages/bb-studio-teams/README.md) |
| Feed | `useOpenCompanion` opens the post, source thread or new discussion; retained reader route | [Source, discussion and item companions](../packages/bb-studio-feed/README.md) |
| Explore | Shared explainer/page destinations; old owner-scoped panel and main fallback when companions are absent | [Explainer/page reuse and retained state](../packages/bb-studio-explore/README.md) |
| Sidebar | Thread Float action uses `openFloat`; ordinary navigation/split stays host-owned | [Real sidebar first moves](../packages/bb-studio-float/README.md) |
| Navigation | Host panel activation/split plus Studio's shared Quick Open placement | [Keyboard/focus checks](review-evidence/2026-10-02/search-accessibility/README.md) |
| Reactions | Composer bridge selects the displayed message's thread; drafts quotes/reactions into it | [Settings, selection and message actions](review-evidence/2026-10-02/reactions-explore/README.md); native right-click remains open |
| Decisions | Shared server queue/model routing; no independent chat view or placement state | [Settings surface and routing tests](../packages/bb-studio-decisions/README.md) |
| Mobile | Existing thread/item identifiers and generated native endpoint contracts | [Native links and delivery surface](../packages/bb-studio-mobile/README.md); device QA remains in the review ledger |

These captures are workflow evidence, not an assertion that every file format,
provider, route variant or device has passed every placement permutation.

## Latest transfer checkpoint

Pages and Float `85a73fa` pass on isolated stable BB 0.45.0 and the optimized
current-core host. The stable check preserves two original edited Pages views
through two swaps, plus pin/tab identity. It then splits beside a third
ordinary page and preserves that original neighboring editor and its draft,
undo and redo. The native check preserves the two original companions in two
distinct visible BB panes.

Kit has 97 passing tests, Float 53, and the full JavaScript suite has 1,585.
All 18 packages typecheck and pass stable compatibility; the packed Kit and
all 16 consumer locks match. The [saved host patch](host-support/native-companions/README.md)
contains eight verified core commits and exact-tree application evidence.

## Remaining release and QA boundaries

- Stable BB has no native retained companion API. The authoritative core
  repository permission is `READ`, so the verified patch needs upstream
  publication and a BB release. Plugin SDK pins remain compatible with stable.
- Stable BB reuses an existing Companions pane for a second Companions split.
  Float guards that action; splits beside ordinary main views pass. The core
  patch fixes exact subpath matching and passes the two-companion case.
- Original core main-thread editor adoption needs that host patch. Stable
  fallback retains a composer after it is realized in Float; it cannot adopt
  the host's original main-thread editor through the released SDK.
- Native Electron right-click Reactions QA is not closed by browser captures.
  This thread's native automation inventory failed to start twice. The
  separate desktop QA lane is paused following its updater incident; further packaged desktop launches are paused in that lane.

Native device, push, VoiceOver and Watch boundaries remain in the separately
owned [review issue ledger](review-issues.md). They do not change the recorded
browser transfer results.
