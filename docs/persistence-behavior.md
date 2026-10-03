# Persistence behavior across Studio

Pages, Draw and Talk use different storage engines. They share the following
user-facing requirements; they do not need a common storage implementation.
This is the persistence acceptance contract from the
[codebase review](codebase-review-2026-10-02.md), with evidence and remaining gaps.

## What each state means

| State | Required behavior |
| --- | --- |
| Editing / pending | Preserve the newest local work. A connected socket, queued request or successful in-memory mutation does not mean the destination saved it. |
| Saved locally | The recovery record has committed to the local store. Describe the destination accurately; local recovery is not a server backup. |
| Saving / uploading | Capture the operation's destination and submitted revision. Later navigation, server switching or typing cannot change that operation. |
| Saved / delivered | The destination acknowledged the submitted content. Clear only that submission's recovery record; keep later edits pending. |
| Failed | Keep available work, show the failure and provide a recovery action. Retrying must not silently replace newer server content or create another item after a lost response. |
| Unrecoverable portion | Identify what is missing, preserve the recoverable portion and require explicit acknowledgement or discard before reporting completion. Never silently insert an incomplete dictation. |

Retries may have a bounded count or a bounded backoff rate. In either case,
failure must remain observable and manual recovery must remain possible.
Navigation and disposal must cancel view-only work without deleting unsaved
content. Deletion is an explicit operation with different semantics from
closing a view or losing a connection.

## Faults every implementation must account for

1. A local write, metadata commit or server save fails. The original bytes or
   latest edit survive wherever storage still permits; a successful status is
   withheld. Disk-full recovery cannot promise survival after closing when the
   only remaining copy is in memory.
2. More work arrives while a save is in flight. Its older acknowledgement does
   not clear the newer work, including deletion-only edits.
3. A response is lost after the server commits. Recovery reconciles with the
   committed result or retries idempotently; it does not duplicate the item.
4. Another editor changes the destination. Merge compatible collaborative
   updates, or retain the local draft with an explicit conflict choice.
5. The view closes or the app restarts. Restore committed recovery records with
   their original item and server identity. Do not guess the origin of legacy
   or corrupt records.
6. Recovery itself fails. Keep the recovery barrier and offer retry or export;
   an error while acknowledging saved work must not erase the last good copy.
7. The user explicitly discards a draft or deletes an item. Remove only the
   selected work and stop its retries; do not restore deleted content into a
   replacement item with the same-looking name.

## Current implementations and evidence

| Surface | Storage and recovery | Automated fault evidence | Live evidence / remaining boundary |
| --- | --- | --- | --- |
| Browser Pages | Origin/page-scoped IndexedDB Yjs snapshots merge atomically. Server acknowledgements follow a successful SQLite save; failures retain snapshots and expose retry/export. Memory-only failures retain a navigation-safe exit warning. | [Hub faults](../packages/bb-studio-pages/src/hub.test.ts) and [connection recovery](../packages/bb-studio-pages/src/ui/connection.test.ts) verify full-state barriers, deletion-only revisions, concurrent edits, ordered local writes and navigation-safe warnings. Final integrated Pages source passes 131 focused tests; these alone do not prove browser recovery. | [Live staged proof](review-evidence/2026-10-02/pages-durability/verification.json) passes actual IndexedDB/reload and two-tab merges, rejected SQLite writes, local-write failures, navigation warnings, download/Retry and 44px phone actions. The complete loop reran at af91530, including metadata Retry and retained deleted-page backup after reload/read failure with no sync or recreation. The status confirms body/comments, not metadata RPCs; a fully offline BB shell is outside this connection-level change. |
| Browser Page titles | Origin/page-scoped immutable localStorage versions and a shared memory fallback. Atomic expected-title comparisons protect other writers; explicit conflict choices, download/discard and predecessor cleanup preserve later work. | [Title recovery faults](../packages/bb-studio-pages/src/ui/page-title.test.ts) cover failed/lost responses, independent views, later typing, scope, quota/read/cleanup failure and module reload. | [Live title recovery](review-evidence/2026-10-02/page-title-recovery/README.md) proves new-document restoration, CAS conflicts, one-write lost-response reconciliation, predecessor cleanup and export after deletion/corrupt reads. Storage-unavailable work still needs download before browser exit. |
| Browser Draw | IndexedDB recovery records hold scene elements, files and deletion tombstones per drawing/editor. Server recovery uses an explicit conflict decision and idempotent saved copy. | [Ordered save queue](../packages/bb-studio-draw/lib/save-queue.test.ts), [draft storage](../packages/bb-studio-draw/lib/drafts.test.ts), [server recovery](../packages/bb-studio-draw/src/server/recovery.test.ts). | [Live recovery assertions](review-evidence/2026-10-02/durable-recovery/draw-verification.json): offline edit/reload, concurrent writer, lost response and quota recovery. Clearing browser data or losing a memory-only edit remains a boundary. |
| Browser Talk | IndexedDB audio parts plus a write-ahead capture marker. Storage failure stops capture, retains the final emitted chunk and blocks automatic insertion. Download and Retry saving recover retained bytes; restart exposes a potentially missing memory-only tail. | [Controller failure matrix](../packages/bb-studio/src/modules/talk/src/client/controller.test.ts), [outbox ownership](../packages/bb-studio/src/modules/talk/src/client/outbox.test.ts). | [Live microphone/storage assertions](review-evidence/2026-10-02/durable-recovery/talk-fixed-verification.json) use a synthetic microphone through the real browser capture path. [Paused export](review-evidence/2026-10-02/durable-recovery/talk-paused-export.json) is separate. Browser eviction and physical microphone behavior are not proved. |
| Native Pages | Atomic server/page-scoped draft files, exact-base conflict handling and a saved submission record for acknowledgement recovery. | [Page draft faults](../apps/ios/Tests/PageDraftTests.swift): restart, server isolation, concurrent typing, lost acknowledgement, disk failure and corrupt/missing records. | Simulator tests use real local files and controlled transport. Physical-device storage/interruption checks remain open. |
| Native Talk | Capture journal plus audio/metadata outbox commits. Failed handoffs retain source files and block finishing. Restart reconciles interrupted capture and unknown orphans; explicit export/discard resolves recovery barriers. | [Real-file commit faults](../apps/ios/Tests/TalkPersistenceTests.swift), [restart recovery](../apps/ios/Tests/TalkRecoveryTests.swift). | Simulator fault tests preserve exact bytes and origin. Real-device interruption, background suspension and low-storage recording remain open. |

## Verification discipline

Exercise the production state machine at its storage or transport boundary.
Assert retained content, destination, subsequent retry and user-visible state,
not just that an error callback ran. Include a successful control case so that
blocking every save cannot make a failure test pass.

Use the normal staged BB application for browser recovery checks. Confirm
restored content after a new document loads, rather than inspecting stale DOM
after triggering reload. Use private simulator source, preferences and fixtures
for native checks. Record whether a fault was injected, a microphone was
synthetic, or a physical device was used. Those distinctions determine what the
evidence proves.

The [issue ledger](review-issues.md) owns current closure status. This contract
does not turn a passing unit suite into a claim of crash-proof storage.
