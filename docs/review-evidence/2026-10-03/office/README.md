# Stage 9 Office QA

## Staged environment

Stable BB 0.45.0. Web captures use the clean six-plugin Git install at
`09bb66a8` on isolated server 52586, including the corrected Office and item
icons. It passes the [fresh install checks](fresh-install.json). Native captures
use server 52386 at `6089c1d`; the native app includes `1bf08d1`.
The capture seed creates three bots (Atlas, Scribe, Quinn), a channel, an Atlas
DM, a reviewed task, a report, and an inert plugin approval. No bot turn or
approval is dispatched. `fresh-install.json` records the final install IDs; `capture-fixtures.json` records
the native screenshot fixture; `fixtures.json` preserves the first capture fixture.

## Web captures

All assertions passed against the real rendered BB application.

- [Home](../../../../packages/bb-studio/assets/staged-preview.png)
- [Inbox, All spaces](../../../../packages/bb-studio/assets/office-inbox.png)
- [Team faces and folders](../../../../packages/bb-studio/assets/office-sidebar.png)
- [Bot desk: Chat](../../../../packages/bb-studio/assets/office-bot-chat.png)
- [Bot desk: Tasks](../../../../packages/bb-studio/assets/office-bot-tasks.png)
- [Space settings](../../../../packages/bb-studio/assets/office-settings.png)
- [Delegate dialog](../../../../packages/bb-studio/assets/office-delegate.png)
- [Ask first approval](../../../../packages/bb-studio/assets/office-approval.png)

Pages, Draw, Float, Reactions, and Mobile also have refreshed primary staged
previews. Float checks that its page editor survives the move from the page
header and opening Office Home.

## Native captures

Private simulator `CF1B0476-6432-46CB-8EB3-255297208A71`, iOS 27.0. Build succeeded.

- [Inbox](office-inbox-ios.png)
- [Home](office-home-ios.png)
- [Work](office-work-ios.png)
- [Team](office-team-ios.png)
- [Bot desk: Chat](office-bot-chat-ios.png)
- [Bot desk: Tasks](office-bot-tasks-ios.png)

All four Office capture tests pass, producing all six screenshots. The checks
assert the real request, report, channel, Atlas desk, and assigned review task.
Two navigation bugs found during capture were fixed by the coordinator in
`c47f355` and `1bf08d1`. Raw result: `/tmp/stage9-ios-final/results.xcresult`.

### Full UI test run

[All failures and counts](ios-ui-results.json): **90 tests, 22 passed, 55 skipped,
13 failed**. The runner uses the explicit isolated server on 52186; no production
server is contacted. Raw results: `/tmp/stage9-ios-full/results.xcresult`.

Failures are retained, not suppressed:

- `testBotInStudio`, `testChannelAutomations`, `testChannelManagement`,
  `testQuickCapture`, `testStudio`, `testStudioBulk`, `testStudioChat`, and
  `testThreadExtras` expect old placement, controls, or menus.
- `testMessageSentTime`, `testRecordingPlayback`, and `testTools` rely on
  message, media, or Daily fixtures that this staged seed does not provide.
- `testQueueRemove` finds the removal control but the queued card stays visible.
  This remains a potential product failure, reported to the coordinator.
- `testPluginStatusAndWorkspaceChoices` passes the plugin-status screen, then
  cannot find the New thread navigation bar after opening `bbstudio://new`.

Skipped tests are not evidence that their workflows work. The four Office
capture tests deliberately skip in this broad run unless their capture fixture
is explicitly enabled. Other skips retain their existing fixture guards.

## Legacy cleanup

[Live cleanup results](cleanup-live.json): seven legacy directories archived and
removed on the original 17-plugin migration fixture. Every archived file hash
was verified. All seven current collection items remained unchanged. Teams was
retained because its bot homes still use that directory. A repeated dry run
reports only the retained directory. No production data directory was touched.

The RPC is `modules_cleanup_legacy({dryRun})`; dry-run defaults to true.
Implementation and archive hardening: `1eb716f`, `4d23945`, `4befc7b`.

## Repository checks

Full `pnpm check` passes, including stable compatibility, contracts, 167 native
RPC call sites, 32 payload fixtures, marketplace, docs, and the packed kit.
Log: `/tmp/stage9-handoff-check.log`. A timing-dependent table fixture failure
was fixed in `2553c55` by stubbing its debounced notification RPC.
The last fresh staged install uses final implementation and capture commit `09bb66a8`;
later changes only affect tests and evidence.
