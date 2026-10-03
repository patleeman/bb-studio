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
