# Office UI test remediation in progress

The original result is 90 tests: 22 passed, 13 failed, 55 skipped.
This file records intermediate evidence; it is not the final suite result.

## Queue removal baseline

`testQueueRemove` also fails at pre-office commit `e81d75b`. No Office
regression bisect is required. The baseline app was exported with `git archive`
to `/tmp/office-ui-baseline`; the isolated runner from `d1a8f4d` was copied into
that export without changing baseline product or test code.

- Private simulator: `6DE2214C-A8C1-4F2F-BE59-70D176BCA8A1`.
- Isolated stable BB origin: `http://127.0.0.1:52186`.
- Scratch scheduled thread: `thr_qpudb9tvca`, project `proj_q33s2eu2af`.
- The message was scheduled for 2031 and was not intentionally sent.
- Result: 1 test, 1 failure (`queued card removed`).
- Result bundle: `/tmp/office-ui-baseline/run/results.xcresult`.
- Server queue after the test: `[]`.
- Screenshot attachment `queue-removed` shows no visible queue card. The
  failure uses an accessibility element count. A follow-up reproduction
  confirmed the removed row remains in the accessibility tree (see below).

## Original skip inventory

The 55 skipped tests fall into these groups (counts from the original xcresult):

| Group | Count | Guard / missing requirement |
|---|---:|---|
| ArtifactRuntimeUITests | 12 | Exact isolated origin, private-simulator opt-in, artifact fixtures; five also require the edge-case proxy |
| ReviewQualityUITests | 16 | Exact isolated review origin; plan tests additionally need a held inert plan fixture |
| ReviewPerformanceUITests | 1 | Exact isolated origin, private-simulator opt-in, 24 performance pages |
| ShareRuntimeUITests | 5 | Share-host app, isolated origin and private-simulator opt-in; send test also requires a dedicated staged project |
| OfficeCaptureUITests | 4 | Office fixture and capture output directory |
| NewSurfacesUITests | 2 | Meeting notes fixture; obsolete Studio Tables plugin lookup |
| ThreadUITests | 15 | Scratch artifact, file, visualization, image, page, queue and reaction fixtures; probe thread; iPad-only test |

Fixture and environment guards must be resolved where the runner can supply
them. A skipped test is not a passing workflow.

## Office navigation retargeting

- `testBotInStudio`: Team → Atlas desk → Tasks/Profile, plus the legacy bot
  deep link using a seeded ID. Checks that bots and conversations are absent
  from the Work collection. Native trust rows combine their label and value.
- `testChannelManagement`: create a scratch saved conversation, open it from
  Team, rename it, add a member, archive and restore it, then delete in teardown.
  Old room modes and permissions have no equivalent on saved conversations.
- `testChannelAutomations`: verify the Team conversation, then exercise the
  current host Automations editor, Once schedule, pause/resume and rename.
  Old channel automation RPCs were removed. The fixture runs an hour in the
  future and is deleted in teardown. Creating it exposed the fractional `runAt`
  bug fixed by the coordinator in `3e705659`.

Stable compatibility passes with BB 0.45.0 / SDK 0.6.15. Invoked as
`pnpm --config.verify-deps-before-run=false check:compat` to avoid pnpm trying to
replace the shared checkout's installed dependencies before running the script.

Focused validation with `3e705659` product code:

- `/tmp/office-retarget-verified/results.xcresult`: channel management passed.
- `/tmp/office-retarget-verified-2/results.xcresult`: bot and automation tests
  both passed, 0 failures, after targeting the combined trust label and the
  nested native switch.

The earlier full run remains in progress at `/tmp/stage9-retarget-full`; it
predates these final selector changes and the automation fix. A fresh staged
install and final full suite run are still required.

## Restored consolidated capabilities

`testQuickCapture` and `testStudioChat` exposed product failures, not removed
features. The Task tile and item-chat controls still checked the retired
`studio-tasks` and `studio-chat` plugin IDs. They now recognize `studio` while
retaining legacy ID compatibility. Drawing notifications/deletion also use the
correct `excalidraw` ID instead of the accidental `talk_excalidraw` string.

Item chat now reads the same per-server running-plugin preference as the thread
screen. This fixes cold task deep links, where Office has not opened or loaded
StudioStore yet. The chat sheet loads project choices before presenting them.
The test verifies the linked thread through consolidated `studio.chat_home`.

- `testQuickCapture` passed: `/tmp/office-capabilities/results.xcresult`.
- `testStudioChat` passed after the cold-start fix:
  `/tmp/office-capabilities-2/results.xcresult` (1 test, 0 failures).
- Native build succeeded. No Office, RootView or AppModel changes were needed.

## Queue removal diagnosis and fix

A fresh scheduled scratch thread reproduced the pre-office failure on current
main. The server queue count went from 1 to 0. XCTest reported the removal
button as `exists=true`, `hittable=false`, count 1 after deletion; the visible
card was gone. `/tmp/office-queue/results.xcresult` retains that failing run.

ThreadShelf kept its empty List at height zero after deleting the last message.
It now removes that List entirely when the queue is empty, including the stale
accessibility row. The test creates and cleans up its own scheduled thread,
checks the server count, and requires the removal control to disappear. It no
longer skips when an unrelated shared thread has no queued message.

Fixed validation: `/tmp/office-queue-fixed/results.xcresult`, 1 test passed,
0 failures. The same staged server and private simulator reproduced the failure
before the fix and passed afterward.

## New-thread presentation and workspace fixture

`testPluginStatusAndWorkspaceChoices` combined a product defect and a fixture
omission. New-thread presentation was attached to InboxView rather than the tab
root. Moving its sheet to RootView fixes Settings deep links and Home/Team
requests without changing tab layout. The coordinator was notified.

The staged Orbit project also lacked any provisioned environment: all its
capture threads were scheduled. NewThreadView correctly offers checkout and
worktree choices only when a ready Git project checkout exists. Staging now
accepts `--ui-tests`, creates one minimal workspace-fixture turn, waits for it,
asserts the ready checkout, and exports the UI-test environment variables.
The same commands were exercised on isolated server 52586, producing environment
`env_pwkcrfm38d` and idle fixture thread `thr_2ewcsn8jby`.

`/tmp/office-new-thread-fixed/results.xcresult`: 2 tests passed, 0 failures:
`testPluginStatusAndWorkspaceChoices` and `testNewThreadFromHomeAndTeam`.
`node --check scripts/staged-bb.mjs` and `git diff --check` passed. The final
fresh install will exercise the new staging option from its pushed commit.

## Tables skip resolved

`testTableViews` incorrectly skipped because it queried the removed
`studio-tables` plugin. It now creates and deletes a deterministic table through
`studio.tables_*`, searches for its unique title, and verifies text and number
values in the native list and grid.

Running it exposed a product defect: Route accepted the legacy Tables URL but
not `/plugins/studio/tables/<id>`. The missing consolidated alias prevented table
rows from opening natively. A one-line AppModel route fix restores navigation;
the coordinator was notified. `/tmp/office-tables-fixed/results.xcresult` reports
1 test passed, 0 failures. The original skip is resolved.

Bulk-tag investigation remains open. Scrolling its chip fully into view still
opened the neighboring Space menu in `/tmp/office-collection-tests/results.xcresult`.
The experimental scrolling change was removed; the test was not weakened.

## Tools fixture and Settings route

`testTools` expected an unseeded automation whose name contained Daily, then
looked for the removed Home automation entry. Staging with `--ui-tests` now
creates a deterministic disabled schedule, `Daily native UI fixture`; it does
not dispatch. The test opens that schedule and checks its detail, retains Usage
and Keep Mac awake coverage, then scrolls Settings and opens Automations there.

`/tmp/office-tools-2/results.xcresult`: 1 test passed, 0 failures. The seed was
exercised against staged server 52586, and both staging scripts pass
`node --check`. No product changes were needed for this failure.

## Tag-chip menu fix; bulk-delete defect isolated

The coordinator approved native Menu with primaryAction after contentShape
failed to isolate each context menu. Space and tag chips now use that control,
retain their label, styling and selected trait, and expose stable per-chip
accessibility identifiers. The bulk test uses the tag identifier across rename.

`/tmp/office-menu-fixed/results.xcresult` built successfully and passed tag
rename, tag deletion, and task archive assertions. Its remaining failure is
`deleted from select mode`. An independent staged RPC reproduction created a
scratch task and called `studio.remove` with pluginId `studio`; it returned
`That space no longer exists` and left the task intact. The diagnostic task was
then cleaned up through tasks_delete. The server remove handler still treats
all consolidated Studio item IDs as spaces. This requires a separate server
fix; the deletion assertion remains in place.

## Consolidated bulk-delete routing fixed

The server's collection remove handler now partitions Studio space IDs (`spc_`)
from consolidated module item IDs. It sends tasks and other module items through
the provider delete path, including existing tag/tab cleanup, and preserves
per-item failures for missing spaces.

The regression test initializes the real Studio plugin and calls its registered
RPCs to create a task, remove it alongside a missing space, and verify the task
is gone while the missing space reports an error. The focused removal, module
runtime and provider-conformance tests pass: 17 tests, 0 failures. Studio
typechecking and stable compatibility pass. Native bulk UI verification awaits
a fresh staged install containing this pushed server fix.

## Fresh staged collection and workspace verification

A fresh install at `/tmp/bb-office-final-stage`, server 52786, installed all
plugins from pushed commit `c9fb0408` and provisioned the native workspace.
`/tmp/office-fresh-remaining/results.xcresult` confirms `testStudioBulk` and
`testThreadExtras` both pass. Bulk tag rename/delete, archive and task deletion
now complete through the live UI. The workspace has a deterministic README
change; testThreadExtras now requires it instead of skipping the diff workflow.
Staging `--ui-tests` writes that change only inside the temporary Orbit checkout.

The same run reproduced `testStudio`'s empty-drawing failure: empty drawings
automatically present their editor, so the generic Back action only dismissed
that sheet. The collection seed now includes a nonempty rectangle scene and a
dictation item. The test requires each of Pages, Recordings, Dictations, Drawings
and Artifacts, scrolls the filter row, opens an item, and asserts return to
Studio instead of silently skipping absent filters/items.

The updated seed was exercised against the fresh install.
`/tmp/office-studio-fixture/results.xcresult`: testStudio passed, 1 test,
0 failures. Staging script syntax and `git diff --check` passed.
These focused runs do not replace the required final full-suite run.

## Five fixture-only skips resolved

After the coordinator explicitly handed off all runner/fixture ownership,
`ui-test.sh` was extended to seed Office and export `BB_OFFICE_CAPTURE_DIR`
automatically when `BB_QA_DATA_DIR` is supplied. The existing guarded Office
seeder creates inert local data; the four capture tests now run in the normal
fixture-enabled suite. `/tmp/office-capture-skip-fix/results.xcresult` confirms
all four pass, 0 failures.

The native fixture seeder also creates one completed recording with deterministic
meeting notes directly in the isolated Talk store. It does not invoke summary
generation or transcription. `testMeetingNotes` requires the exported recording
ID and checks the exact summary, replacing its missing-recording skip.
`/tmp/office-notes-skip-fix/results.xcresult`: 1 passed, 0 failures. This run also
exercised the automatic Office seed invocation; its generated xctestrun contains
the capture directory and meeting recording ID. Node/shell syntax checks and
`git diff --check` pass.

## Three thread fixture skips resolved

`testQueueEdit`, `testQueueReorder`, and `testRenameThread` now create their own
scheduled scratch threads and delete them in teardown. Queue edit seeds its
expected message; reorder seeds three messages. None dispatches an agent.
They no longer skip for a missing shared `BBGO_QA_QUEUE_THREAD`, and their
mutation state cannot leak between tests or repeated runs.

`/tmp/office-queue-skips/results.xcresult`: 3 passed, 0 failures, on the private
simulator against staged server 52786. `git diff --check` passed.

## Page fixture skips resolved

`testPageTools` and `testPageComments` now each create an owned scratch page
through Pages RPC and remove it in teardown. The comments test seeds an anchored
`Is this final?` thread on a real page block, then exercises reply, resolve and
new-comment creation. The tools test retains work-bar, saved-version and rename
coverage. Neither depends on `BBGO_QA_PAGE` or prior test state.

`/tmp/office-page-skips/results.xcresult`: 2 passed, 0 failures against staged
server 52786 on the private simulator. `git diff --check` passed.

## Terminal enabled; voice capability checked

`testTerminal` now uses the staged thread with a provisioned checkout instead
of skipping when an unrelated queue-thread environment variable is absent.
It passed terminal creation, attachment, shell input and closure in
`/tmp/office-terminal-voice/results.xcresult`.

`testVoiceChat` now creates and removes its own scheduled scratch thread. Its
first enabled run granted microphone/speech permission, then displayed the exact
Apple error `Speech recognition stopped: Failed to initialize recognizer` on
the iOS 27 Simulator. This is a runtime capability limitation, not a missing
fixture. The test now checks pause/resume and end controls before skipping only
that exact error on Simulator. Device listening and permission-recovery checks
remain unchanged; other errors still fail.

`/tmp/office-voice-capability/results.xcresult` verifies the failed-session
controls and records 1 explicit capability skip, 0 failures. Speech recognition
itself still requires a speech-capable device. `git diff --check` passed.

## Performance fixture skip resolved

The isolated runner now marks its explicit private-simulator configuration and
seeds 24 real `Native Performance` pages with multi-paragraph content. The
performance suite accepts the configured isolated loopback origin rather than
requiring a retired fixed review port. It opens Work → All items → Pages,
preserving its scrolling, page-content, return-navigation and metric assertions.

`/tmp/office-performance-2/results.xcresult`: 1 passed, 0 failures; 12 navigation
cycles including warm-up. Five measured iterations averaged 35.420 seconds per
two-cycle iteration; peak physical memory averaged 124,223 kB. These are observed
measurements, not a regression-baseline claim. Node/shell syntax checks and
`git diff --check` passed. The fixture-enabled full runner will include this test.

## Read-only thread fixtures and file/timeline repairs

The isolated seed now creates idle, inert timelines for reactions and scrolling,
find/mentions/drafts/model selection, completed file edits, file links, Markdown
images, inline HTML/Markdown, and saved artifact cards. It creates only local
fixture files and events, cancels the scheduled placeholder, and validates every
timeline through the real API before passing generated IDs to XCTest.

Enabling this coverage exposed three product incompatibilities with stable BB:

- Host files were requested at `host-files/content?path=…`, which the server
  interpreted as `/content`. File links and images now use the path-shaped route.
- Inline HTML used the removed thread `worktree/files` route. Previews now use
  the URL returned by `inline-vis.preparePreview`, including its environment.
- Completed tool steps were hidden inside server turn containers that iOS
  discarded. Timeline requests now include nested rows and the existing activity
  group renders the children, restoring completed file-edit and diff navigation.

`testFeatures` also targets the current Model & Permissions sheet title.
`testThread` requires its seeded reactions instead of skipping an arbitrary
thread without them. The runner retains all existing assertions.

`/tmp/office-thread-fixtures-3/results.xcresult`: 7 passed, 0 failed, 0 skipped:
`testArtifact`, `testFeatures`, `testFileLink`, `testInlineVis`,
`testMarkdownImage`, `testProbe`, and `testThread`. This run includes all three
product repairs and the idle fixture timelines. Build, Node syntax checks,
`git diff --check`, and stable compatibility (all seven plugins) passed.
The fresh full-suite run and Review/Artifact/Share harness skip work remain.
