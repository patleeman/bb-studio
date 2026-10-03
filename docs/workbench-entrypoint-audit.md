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
| Studio Chat | One Chat action, linked conversation, creation/picking, item-specific quotes and retained composer routes | [Draft/file/image quote and phone recovery](../packages/bb-studio/src/modules/chat/README.md) |
| Float | Canonical stack, pins/history, explicit Float/main/split/swap; optional native workbench | [Stable and native transfers](../packages/bb-studio-float/README.md) |
| Pages | Shared Chat; standalone fallback and legacy chat-route migration; original editor ownership | [Standalone migration and compact controls](../packages/bb-studio-pages/README.md) |
| Talk | Retained recording/player routes; dictation and Go back target the originating composer | [Exact draft/file return and playback continuity](../packages/bb-studio-talk/README.md) |
| Draw | Retained canvas, shared item Chat and companion-aware related references | [Original first-move canvas and compact header](../packages/bb-studio-draw/README.md) |
| Artifacts | Retained viewer, text/image/HTML quotes through shared Chat | [Viewer/quote formats and compact controls](../packages/bb-studio/src/modules/artifacts/README.md) |
| Tables | Retained table/view route, shared header and canonical item references | [Compact header, real editing/import and bounded rendering](../packages/bb-studio/src/modules/tables/README.md) |
| Tasks | Shared task/board header; current/earlier handoffs, discussions and dispatch use companions | [Retained handoff composer and real bot dispatch](../packages/bb-studio/src/modules/tasks/README.md) |
| Teams | Bot Chat, channels and member-thread entry points; `hasOwnChat` suppresses redundant automatic item chat | [Channel composer/file retention and conversation reuse](../packages/bb-studio/src/modules/teams/README.md) |
| Feed | `useOpenCompanion` opens the post, source thread or new discussion; retained reader route | [Source, discussion and item companions](../packages/bb-studio/src/modules/feed/README.md) |
| Explore | Shared explainer/page destinations; old owner-scoped panel and main fallback when companions are absent | [Explainer/page reuse and retained state](../packages/bb-studio-explore/README.md) |
| Sidebar | Thread Float action uses `openFloat`; ordinary navigation/split stays host-owned | [Real sidebar first moves](../packages/bb-studio-float/README.md) |
| Navigation | Host panel activation/split plus Studio's shared Quick Open placement | [Keyboard/focus checks](review-evidence/2026-10-02/search-accessibility/README.md) |
| Reactions | Composer bridge selects the displayed message's thread; drafts quotes/reactions into it | [Settings, selection and message actions](review-evidence/2026-10-02/reactions-explore/README.md); native right-click remains open |
| Decisions | Shared server queue/model routing; no independent chat view or placement state | [Settings surface and routing tests](../packages/bb-studio/src/modules/decisions/README.md) |
| Mobile | Existing thread/item identifiers and generated native endpoint contracts | [Native links and delivery surface](../packages/bb-studio-mobile/README.md); device QA remains in the review ledger |

These captures are workflow evidence, not an assertion that every file format,
provider, route variant or device has passed every placement permutation.

## Split and neighboring-editor checkpoint

Pages and Float `a36295c` pass on isolated stable BB 0.45.0 and the optimized
current-core host. The stable check preserves two original edited Pages views
through two swaps, plus pin/tab identity. It then splits beside a third
ordinary page and preserves that original neighboring editor and its draft,
undo and redo. The native check preserves the two original companions in two
distinct visible BB panes.

Kit has 99 passing tests, Float 53, and the full JavaScript suite has 1,599.
All 18 packages typecheck and pass stable compatibility; the packed Kit and
all 16 consumer locks match. The [saved host patch](host-support/native-companions/README.md)
contains nine verified core commits and exact-tree application evidence.

## Cross-plugin transfer matrix

The seven view types below pass on isolated stable BB 0.45.0 and the optimized
current-core host with plugins installed from pushed `a36295c`. Stable moves
the original main view through Float → main → Float → main. The native host
moves it through Float → workbench → main → Float → workbench. Each move
checks exact original control identity, connectedness, visible viewport,
requested placement and one saved tab for its target.

| View | Original controls checked | Stable capture | Native capture |
| --- | --- | --- | --- |
| Pages | ProseMirror editor; backward text anchor/focus through first adoption | [Main](../packages/bb-studio-pages/assets/companion-transfers-stable.png) | [Workbench](../packages/bb-studio-pages/assets/companion-transfers-native.png) |
| Draw | Both original Excalidraw canvas layers | [Main](../packages/bb-studio-draw/assets/companion-transfers-stable.png) | [Workbench](../packages/bb-studio-draw/assets/companion-transfers-native.png) |
| Artifacts | HTML iframe, same embedded frame/loader and in-memory document value | [Main](../packages/bb-studio/src/modules/artifacts/assets/companion-transfers-stable.png) | [Workbench](../packages/bb-studio/src/modules/artifacts/assets/companion-transfers-native.png) |
| Talk | Recording title input; existing playback proof is linked above | [Main](../packages/bb-studio-talk/assets/companion-transfers-stable.png) | [Workbench](../packages/bb-studio-talk/assets/companion-transfers-native.png) |
| Tables | Title input and seeded table row | [Main](../packages/bb-studio/src/modules/tables/assets/companion-transfers-stable.png) | [Workbench](../packages/bb-studio/src/modules/tables/assets/companion-transfers-native.png) |
| Tasks | Board title input and seeded task | [Main](../packages/bb-studio/src/modules/tasks/assets/companion-transfers-stable.png) | [Workbench](../packages/bb-studio/src/modules/tasks/assets/companion-transfers-native.png) |
| Teams | Original profile input and unsaved name, preserving `/profile` route | [Main](../packages/bb-studio/src/modules/teams/assets/companion-transfers-stable.png) | [Workbench](../packages/bb-studio/src/modules/teams/assets/companion-transfers-native.png) |

These checks exposed three defects: Teams reset resolved model defaults and
accepted picker-only updates, profile moves used a different route from the
view on screen, and DOM reparenting preserved an iframe element while reloading
its embedded document. Teams now settles defaults and carries the actual
route. Kit keeps pending transfers connected in a parking container, preserves
selection direction and uses state-preserving DOM moves when available.
Float's stable wrapper and the ninth core patch use the same move behavior.
Browsers without that DOM API use the compatible append fallback; embedded
document state continuity is established only for the tested browser hosts.

After sourcing the appropriate isolated `capture.env`, select `native` or
`stable` and the corresponding capture IDs:

```sh
BB_CAPTURE_PLUGIN= BB_CAPTURE_SUITE_TRANSFERS=1 \
BB_CAPTURE_TRANSFER_SELECTION=1 BB_CAPTURE_TRANSFER_FRAME=1 \
BB_CAPTURE_SUITE_HOST=native \
BB_CAPTURE_ONLY=suite-native-pages,suite-native-draw,suite-native-artifacts,suite-native-talk,suite-native-tables,suite-native-tasks,suite-native-teams \
node scripts/capture-plugin-screenshots.mjs
```

The Pages direction check invokes the production Float host for its first
move so pointer focus cannot replace the selection before transfer. Other
initial moves and all later placement changes use the real UI controls.
Cleanup unloads each synthetic view before deleting its fixture, preventing
deletion navigation from becoming the next capture's companion.

The integrated checkpoint passes 1,599 JavaScript tests across all 18 packages,
including 99 Kit and 121 Teams tests, plus all type, stable compatibility,
documentation, marketplace, contract, native-payload and packed-Kit gates.

## Remaining content-plugin entry points

Studio, Studio Chat, Feed and Explore installed from pushed `c83c4fd` pass
the same placement matrix on both isolated hosts. These supplement the
seven content types above, giving representative original-view transfer
proof for all eleven retained content plugins. Every first move uses the
visible **Move → Float this** action; every later move uses companion chrome.
Kit exports `ViewMoveMenu`, and conversation composers accept a `moveTarget`.

| View | Original state checked | Stable capture | Native capture |
| --- | --- | --- | --- |
| Studio collection | Search input, query and seeded release-note result | [Main](../packages/bb-studio/assets/companion-transfers-stable.png) | [Workbench](../packages/bb-studio/assets/companion-transfers-native.png) |
| Item-chat draft | Prompt, unsent wording, file input, selected attachment control and encoded item path | [Main](../packages/bb-studio/src/modules/chat/assets/companion-transfers-stable.png) | [Workbench](../packages/bb-studio/src/modules/chat/assets/companion-transfers-native.png) |
| Feed reader | Search input, unapplied filter and seeded release post | [Main](../packages/bb-studio/src/modules/feed/assets/companion-transfers-stable.png) | [Workbench](../packages/bb-studio/src/modules/feed/assets/companion-transfers-native.png) |
| Feed post | Original post heading | [Main](../packages/bb-studio/src/modules/feed/assets/feed-post-companion-transfers-stable.png) | [Workbench](../packages/bb-studio/src/modules/feed/assets/feed-post-companion-transfers-native.png) |
| Feed discussion | Prompt, unsent wording, file input and selected attachment control | [Main](../packages/bb-studio/src/modules/feed/assets/feed-discussion-companion-transfers-stable.png) | [Workbench](../packages/bb-studio/src/modules/feed/assets/feed-discussion-companion-transfers-native.png) |
| Explore explainer | Iframe, same embedded frame/loader and in-memory document value | [Main](../packages/bb-studio-explore/assets/companion-transfers-stable.png) | [Workbench](../packages/bb-studio-explore/assets/companion-transfers-native.png) |

The chat check reproduced double encoding: the host passes an already-encoded
item subpath, but main-view ownership encoded it again. Kit's shared
`panelHref` now canonicalizes encoded host and decoded companion subpaths to
the same target. Two regression cases prove original composer and attachment
input adoption rather than a fresh composer at another route. The native
file input clears its selected FileList after handing files to composer state;
the live check follows the original input and rendered attachment control.

Run the supplemental captures after sourcing the matching isolated env file:

```sh
BB_CAPTURE_PLUGIN= BB_CAPTURE_STAGE_ENV=/path/to/isolated/capture.env \
BB_CAPTURE_SUITE_TRANSFERS=1 BB_CAPTURE_TRANSFER_FRAME=1 \
BB_CAPTURE_SUITE_HOST=native \
BB_CAPTURE_ONLY=suite-native-studio,suite-native-chat,suite-native-feed,suite-native-feed-post,suite-native-feed-discussion,suite-native-explore \
node scripts/capture-plugin-screenshots.mjs
```

Use `stable` and `suite-stable-*` for the stable host. The matching env file
guards the Explore database fixture; the saved HTML page and all other
fixtures use normal plugin RPCs. No agent runs. The integrated checkpoint
passes 1,631 JavaScript tests across 18 packages, including 106 Kit tests,
plus all type, stable compatibility, documentation, marketplace, contract,
native-payload and packed-Kit gates. The additional route variants below now
extend this placement coverage.

## Additional route variants

Studio `1b2e5a2`, with Chat and Explore `c83c4fd`, passes seven more routes on
both hosts. Each uses the same original-control, visibility, unique-tab and
placement assertions. All initial moves use the displayed Move menu.

| Route | Original state checked | Stable capture | Native capture |
| --- | --- | --- | --- |
| Studio's legacy collection address | Search input/query, seeded release notes and actual `/collection` target | [Main](../packages/bb-studio/assets/studio-collection-companion-transfers-stable.png) | [Workbench](../packages/bb-studio/assets/studio-collection-companion-transfers-native.png) |
| Studio Activity | Original period selector, selected 30 days and the nonexecuting staged thread | [Main](../packages/bb-studio/assets/studio-activity-companion-transfers-stable.png) | [Workbench](../packages/bb-studio/assets/studio-activity-companion-transfers-native.png) |
| Studio space without Pages | Original space-options control and synthetic fallback space | [Main](../packages/bb-studio/assets/studio-space-companion-transfers-stable.png) | [Workbench](../packages/bb-studio/assets/studio-space-companion-transfers-native.png) |
| Plain chat draft | Original prompt/file input, unsent wording and one selected attachment control | [Main](../packages/bb-studio/src/modules/chat/assets/chat-plain-companion-transfers-stable.png) | [Workbench](../packages/bb-studio/src/modules/chat/assets/chat-plain-companion-transfers-native.png) |
| Saved quote draft | Original prompt/file input, source quote, location, note, appended wording and one attachment control | [Main](../packages/bb-studio/src/modules/chat/assets/chat-quote-companion-transfers-stable.png) | [Workbench](../packages/bb-studio/src/modules/chat/assets/chat-quote-companion-transfers-native.png) |
| Explore collection | Original seeded explainer-row button and collection route | [Main](../packages/bb-studio-explore/assets/explore-list-companion-transfers-stable.png) | [Workbench](../packages/bb-studio-explore/assets/explore-list-companion-transfers-native.png) |
| Explore thread list | Original seeded explainer-row button and thread-specific route | [Main](../packages/bb-studio-explore/assets/explore-thread-companion-transfers-stable.png) | [Workbench](../packages/bb-studio-explore/assets/explore-thread-companion-transfers-native.png) |

The legacy Studio alias exposed another route mismatch: the main wrapper
registered `/collection`, while the inner view constructed Move for the root
collection. The view now keeps its actual subpath. Activity also now has the
shared Move control. Its 134 tests, typecheck and build pass, including an
independent rerun after the root full check.

The fallback test disables the installed Pages plugin in the isolated app,
creates its synthetic space through Studio RPC, checks every move, deletes
that space, and re-enables Pages in cleanup. It does not mock provider
availability. The quote fixture uses the production item-chat bridge, then
unloads its initial companion and opens the saved quote route in main before
editing and moving it. No message is sent. Repeated plain-draft captures
remove only the previous synthetic `review-notes.txt` attachment before
selecting their new file; every placement requires exactly one attachment.

Use the prior command with the following capture IDs (and their `stable`
equivalents):

```sh
BB_CAPTURE_ONLY=suite-native-studio-collection,suite-native-studio-activity,suite-native-studio-space,suite-native-chat-plain,suite-native-chat-quote,suite-native-explore-list,suite-native-explore-thread
```

The integrated root checkpoint `19dbbf2` passes 1,641 JavaScript tests across
18 packages and all type, stable compatibility, documentation, marketplace,
contract, native-payload and packed-Kit gates. These checks establish the
listed routes and workflows, rather than every possible dialog/provider or
browser combination.

## Interrupted drag recovery

The refreshed `float-drag-cleanup` capture passes in stable BB 0.45.0 and
the isolated patched core `318990df9`, with Pages and Float `a36295c`.
Real browser pointer input starts a sidebar item drag. Escape clears its
overlay without opening a tab. A second drag removes its synthetic source
link; a document listener verifies that no `dragend` arrives. Releasing and
resuming ordinary pointer input still clears the overlay. The same link is
restored before successful and repeated drops, which both retain the exact
original main Pages editor in exactly one tab. Every case requires the drop
zone to disappear.

The [stable](../packages/bb-studio-float/assets/drag-preview.png) and
[native-host](../packages/bb-studio-float/assets/drag-preview-native.png)
captures show the final floated page. This establishes the cleanup paths,
including a deliberately missing event, rather than assigning a specific
cause to the user's earlier freeze. No new production source was needed.

```sh
BB_CAPTURE_FLOAT_DRAG=1 BB_CAPTURE_ONLY=float-drag-cleanup \
node scripts/capture-plugin-screenshots.mjs --plugin float
```

Source the matching isolated env first; add `BB_CAPTURE_SUITE_HOST=native`
for the patched host. The synthetic page is deleted after unloading its view.

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
