# Office iOS UI final results

**98 tests: 91 passed, 5 failed, 2 skipped.** The fresh full run reports **Failed**.

The original target was a full run with zero failures. The coordinator later
instructed this worker to stop the accessibility investigation after one last
Home localization attempt, run the fresh full suite and report unresolved
findings honestly. A nonzero result below is not a passing suite or proof that
all original requirements are satisfied.

## Fresh full run

- Product and plugin source: `26d7a1e7b36cbd81fc492bfd789a5e911744f91b`, latest pushed main when staging started.
- Fresh staged directory: `/tmp/bb-office-final-fresh`; isolated origin `http://127.0.0.1:52886`.
- Stable BB: `0.45.0`; simulator: iOS 27, `6DE2214C-A8C1-4F2F-BE59-70D176BCA8A1`.
- Fresh Orbit project: `proj_9ysptyrrtk`; provisioned workspace thread: `thr_x2uump2i9w`.
- Build/run directory: `/tmp/office-ui-final-full`; complete result bundle: `/tmp/office-ui-final-full/results.xcresult`.
- No selected-test filter. All `BBStudioUITests` ran through the isolated runner with `BB_QA_DATA_DIR` supplied.
- [Fresh install provenance and fixture IDs](ios-ui-final-run.json).
- [Machine-readable final summary](ios-ui-final-results.json); [individual test results](ios-ui-final-tests.json).

```sh
BB_STAGED_DIR=/tmp/bb-office-final-fresh BB_STAGED_PORT=52886 \
  node scripts/staged-bb.mjs start --ref 26d7a1e7 --plugin studio --ui-tests
source /tmp/bb-office-final-fresh/capture.env
BB_TEST_SIMULATOR_ID=6DE2214C-A8C1-4F2F-BE59-70D176BCA8A1 \
BB_QA_DATA_DIR=/tmp/bb-office-final-fresh/data \
BB_UI_TEST_RUN_DIR=/tmp/office-ui-final-full \
  bash apps/ios/scripts/ui-test.sh
```

## Decisions for the original 13 failures

| Original failure | Decision and retained coverage | Fresh full result |
| --- | --- | --- |
| `testBotInStudio` | **Retarget moved UI.** Team → Atlas desk, Tasks and Profile; retain legacy bot deep-link coverage and assert bots/conversations are absent from Work's collection. | **Passed** |
| `testChannelAutomations` | **Retarget + pre-existing product fix.** Use Team conversation and Settings host Automations; retain create/edit/pause/delete coverage. Once runAt now uses integer milliseconds; native payload coverage verifies it. | **Passed** |
| `testChannelManagement` | **Retarget removed channel model.** Exercise scratch Team conversation create/open/rename/member/archive/restore/delete; removed room modes have no saved-conversation equivalent. | **Passed** |
| `testMessageSentTime` | **Deterministic fixture.** Seed an inert completed assistant message with a known timestamp; require its sent-time menu. | **Passed** |
| `testPluginStatusAndWorkspaceChoices` | **Product fix + fixture.** Present the newThreadDraft sheet from RootView; provision a real Git checkout so new-thread checkout/worktree choices are meaningful. | **Passed** |
| `testQueueRemove` | **Pre-existing product fix.** Remove the empty queue List so its stale accessibility row disappears; use a scheduled scratch thread and assert server queue plus UI removal. | **Passed** |
| `testQuickCapture` | **Product capability fix.** Recognize consolidated Studio capabilities so Task appears alongside Dictate; retain capture workflow coverage. | **Passed** |
| `testRecordingPlayback` | **Deterministic media fixture.** Seed real segmented WebM/Opus and MP4/AAC audio plus transcripts; verify playback, segment skip, transcript seek, speed and pause. | **Passed** |
| `testStudio` | **Retarget + fixtures + product fix.** Require Pages, Recordings, Dictations, Drawings and Artifacts; seed nonempty drawings and correct Excalidraw notification/deletion routing. | **Passed** |
| `testStudioBulk` | **Product fixes.** Give Space/tag chips individual native Menus and identifiers; fix consolidated Studio removal to partition Space IDs and item IDs. Retain tag rename/delete, archive and bulk task deletion. | **Passed** |
| `testStudioChat` | **Product capability fix + retarget.** Recognize consolidated Studio on cold item deep links, load chat project choices and verify the linked item thread through current RPCs. | **Passed** |
| `testThreadExtras` | **Retarget + deterministic workspace.** Use current thread actions and a provisioned checkout with a known README edit; require Files & changes and actual diff content. | **Passed** |
| `testTools` | **Retarget + fixture.** Open Automations from Settings, seed a disabled Daily schedule and retain usage, Keep Mac awake and automation-detail coverage. | **Passed** |

Original 13 outcomes: 13 passed.

The queue failure is **pre-existing**, not an Office regression. The unmodified
`e81d75b` app/test against all 17 plugins from that same commit fails the original
removed-card assertion even though the server queue is empty. Therefore a bisect
was not warranted. Removing the empty SwiftUI List fixes the stale accessibility
row. [Exact baseline and result](queue-baseline-exact.md).

Coordinator-owned changes stayed within approval: RootView presents the existing
new-thread draft sheet from the tab root; AppModel accepts the consolidated
Studio Tables route; OfficeEventRow uses an explicit opening button, combines
its noninteractive text, keeps separate 44-point action buttons, stacks them at
accessibility sizes, removes the title cap and uses semantic label colors.
The intentional body preview stays capped at three lines at default sizes.
Office section headers, Face semantics, SpaceMark contrast and item wrapping
follow the coordinator's specific approvals. [Native before/after crops and
focused validation](audit-policy/README.md).

## Original 55 skips

| Original group | Count | Cause and resolution |
| --- | ---: | --- |
| ArtifactRuntimeUITests | 12 | Historical exact origin and missing artifact/proxy fixtures. Runner now creates real owned artifacts and a restricted loopback proxy for lookup failure, version races and blob recovery. |
| ReviewQualityUITests | 16 | Historical exact origin, private simulator guard and missing held plan. Runner provides isolated origin/private simulator and an inert held plan; checks now run, with failures retained. |
| ReviewPerformanceUITests | 1 | Missing private simulator opt-in and 24 pages. Runner seeds 24 real performance pages; scrolling/navigation/metrics remain enabled. |
| ShareRuntimeUITests | 5 | Missing Share fixture host, staged preferences and dedicated project. Runner installs the real Share host and verifies actual payloads in the staged project. |
| OfficeCaptureUITests | 4 | Missing Office fixtures/output directory. Runner seeds Office and exports `BB_OFFICE_CAPTURE_DIR`. |
| NewSurfacesUITests | 2 | Missing meeting notes and obsolete Tables plugin lookup. Runner seeds completed notes; Tables uses consolidated Studio RPCs and a scratch table. |
| ThreadUITests | 15 | Missing scratch artifact, page, file, timeline, queue and reaction state, probe thread and iPad form factor. Runner seeds inert timelines/media/files; mutating tests create and clean their own scratch items; terminal uses a provisioned checkout. iPad-only remains a device-scope guard. |

The final run skipped 2 tests:

- `ThreadUITests/testIPad()`: iPad only
- `ThreadUITests/testVoiceChat()`: This Simulator cannot initialize Apple's speech recognizer; failed-session pause/end verified. Listening requires a speech-capable device.

[Each of the original 55 tests and its final result](ios-ui-skip-resolution.md) is recorded individually. The source fixture guards remain fail-closed for non-isolated use.

A simulator speech-recognition limitation is a capability gap, not a fixture
omission: `testVoiceChat` skips only the exact “Failed to initialize recognizer”
error after verifying failed-session pause/resume/end. Other speech errors fail.
An iPhone run does not establish the iPad workflow or successful device speech.
No audit finding is turned into an XCTest skip.

## Approved audit exceptions and evidence

The final run applied **69 individually recorded exceptions/retry resolutions**. [Every application, exact test, element/frame, reason and measured ratio](final-audit-evidence/exceptions.md) is retained alongside [the per-test screenshots and proof records](final-audit-evidence/index.md). [Machine-readable audit results](final-audit-evidence/audit-results.json) include unresolved findings as well. An applied exception does not make a failing test pass when another finding remains.

The exception rules are deliberately scoped:

1. Contrast on identified disabled `captureNoteSave` only when `isEnabled == false`.
2. A resolved element at a queried native material bar must no longer be reported by a second contrast audit after being scrolled completely clear. Initial/retry screenshots, results and frames are retained. Truly nil findings never qualify.
3. A resolved element must have a measured rendered text/background ratio of at least 4.5:1. The screenshot, RGB sample and ratio are retained; insufficient samples fail closed. This includes SpaceMark and tinted toolbar text.
4. Identified Capture clipping flags require exact OCR at default and accessibility XXXL, confidence >= 0.95, no ellipsis and glyph bounds inside the control, then a repeat proof in the audited viewport.
5. Fixed toolbar Dynamic Type flags require an actual long press showing the enlarged Large Content Viewer label; OCR confirms exact text and at least 1.25x glyph growth.
6. The four identified Settings text-scaling findings require exact OCR at both sizes, confidence >= 0.95, contained glyph bounds and at least 1.25x growth. The current run reproduces that evidence before applying the rule.
7. A decorative single emoji contrast finding qualifies only when its nonempty queried frame is contained by an `officeFace` image with an accessible name. Image label/frame and screenshot are retained. Initials, ordinary text and nil findings do not qualify.

The title/body-cap experiment did **not** establish that Home's unidentified
clipping came from intentional preview truncation. Removing the body cap still
failed; removing the top action section also failed. Both experiments were
restored, and no nil clipping or nil Dynamic Type exception was added.
[Both negative experiments and retained screenshots](audit-policy/README.md#negative-body-cap-experiment).

## Unresolved findings and limits

The five failures represent three unresolved areas: Studio Search clipping at
both text sizes; locating the held plan request at accessibility XXXL in the
Inbox and plan tests; and a Studio artifact metadata contrast finding that did
not satisfy the material-retry proof. Every executed ThreadUITests and
WorkflowUITests test passed; ThreadUITests contains the two reported skips.

The plan interaction remains pending and is present in the [server Inbox
response](final-audit-evidence/plan-inbox-diagnostic.json). The native failure
hierarchy exposes the preceding Atlas request, but not the held plan request.
This supports a test scrolling/virtualization diagnosis; no fix is claimed.
[Inbox failure frame](final-audit-evidence/inbox-approval-xxxl-failure.png) and
[plan failure frame](final-audit-evidence/plan-approval-xxxl-failure.png) were
extracted 0.1 seconds and three seconds, respectively, before the end of the
corresponding native screen recordings ( `DF3F13DB-A219-4C1D-A9B8-3C490D26093B.mp4` and
`5D44D98A-5ECF-4D1A-9263-BD54D3B52E7B.mp4` in the exported attachments).
Both default-text approval checks passed.

The earlier unidentified Home clipping/Dynamic Type findings did not recur in
this fresh run. They were not excluded; their cause remains unexplained. The
negative localization experiments remain evidence of that limit.

Xcode reported a post-run `simctl` diagnostic-collection error after completing
all 98 tests. The test result bundle, individual results and native attachments
were successfully exported. The five asserted test failures are independent of
that diagnostics warning.

### `ReviewQualityUITests/testInboxApprovalActionsAtAccessibilityText()`

```text
XCTAssertTrue failed
```

### `ReviewQualityUITests/testNavigationAtAccessibilityText()`

```text
XCTAssertTrue failed - studio-accessibility-xxxl: XCUIAccessibilityAuditType(rawValue: 131072) Text of this UISearchBarTextField may be clipped at larger Dynamic Type sizes. [Search Studio] frame=Optional((16.0, 116.0, 370.0, 124.0)) id= nativeBars=[(0.0, 791.0, 402.0, 83.0), (0.0, 62.0, 402.0, 188.0)]
```

### `ReviewQualityUITests/testNavigationAtDefaultText()`

```text
XCTAssertTrue failed - studio-default: XCUIAccessibilityAuditType(rawValue: 131072) Text of this UISearchBarTextField may be clipped at larger Dynamic Type sizes. [Search Studio] frame=Optional((16.0, 116.0, 370.0, 44.0)) id= nativeBars=[(0.0, 791.0, 402.0, 83.0), (0.0, 62.0, 402.0, 108.0)]
```

### `ReviewQualityUITests/testPlanApprovalActionsAtAccessibilityText()`

```text
XCTAssertTrue failed
```

### `ReviewQualityUITests/testStudioRowsAtAccessibilityText()`

```text
XCTAssertTrue failed - studio-rows-accessibility-xxxl: XCUIAccessibilityAuditType(rawValue: 1) Contrast failed for SwiftUI.AccessibilityNode [Artifact · Orbit · Text · 21 B · 1 version] frame=Optional((80.0, 739.3333333333334, 223.66666666666663, 204.33333333333326)) id= nativeBars=[(0.0, 791.0, 402.0, 83.0), (0.0, 62.0, 402.0, 54.0)]
```


The original [90-test result](ios-ui-results.json) remains unchanged: 22 passed,
13 failed, 55 skipped. Added regression and evidence checks explain the final
suite's larger test count. Focused passes are recorded in
[ios-ui-progress.md](ios-ui-progress.md), [fixture evidence](ios-fixture-results.md)
and [retarget evidence](ios-ui-retarget-results.md); they are not substituted for
the fresh full-run results above.
