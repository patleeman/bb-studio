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
  failure uses an accessibility element count, so it does not by itself prove
  that a card remained visible. Further investigation is required.

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
