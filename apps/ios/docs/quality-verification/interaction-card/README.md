# Native approval-card layout and contrast

The approval row is verified at default and accessibility XXXL text sizes.
Approve plan and Keep planning now retain full labels. At accessibility sizes,
the actions stack at full card width; every label/content target has a 44-point
minimum. Existing app accent colors replace the low-contrast green/red fills.
Decision enumeration, labels and `approvalResolution(decision)` stay unchanged.
No approval decision was submitted during this review.

[Before](baseline-accessibility-xxxl.png),
[default after](plan-approval-default-keep-planning.png) and
[XXXL after](plan-approval-accessibility-xxxl-keep-planning.png)
show the actual running app, not a mockup.

## Results

The private build succeeded. The XXXL method passed in 22.210 seconds. The
**default method failed** in 20.352 seconds: its approval-specific assertions
passed, then Apple's whole-screen hit-region audit flagged the message's
Show more control outside InteractionCard. The original
[issue crop](testPlanApprovalActionsAtDefaultText-element-screenshot.png),
[app screenshot](testPlanApprovalActionsAtDefaultText-app-screenshot.png) and
[issue description](testPlanApprovalActionsAtDefaultText-complete-issue-description.txt)
retain that open finding. Neither this run nor the earlier strict accessibility
gate is described as globally green.

| Approval target | Default bounds | XXXL bounds |
| --- | --- | --- |
| Approve plan | 110.3 × 54 points | 346 × 68.7 points |
| Keep planning | 117.3 × 54 points | 346 × 68.7 points |

Both labels were hittable in both sizes. Only Open thread was tapped.
The exact held pending interaction record remained unchanged after both tests.
[Run summary](run-summary.json) and [test results](interaction-test-results.json)
retain assertions, bounds, source fingerprints, device identity and raw result
location.

## Actual button text contrast

The solid background RGB values were read from the PNG pixels. White text is
present on each button. The ratio uses the standard sRGB linearization and
relative-luminance formula, `(Llighter + 0.05) / (Ldarker + 0.05)`.

| Capture | White text on fill | Ratio |
| --- | --- | --- |
| Baseline approve | `#34C759` | 2.220:1 |
| Baseline deny | `#FF383C` | 3.570:1 |
| Corrected default and XXXL | Existing accent `#C7431A` | 4.946:1 |

Green failed even the 3:1 large-text threshold; red failed the 4.5:1 normal-text
threshold. The corrected light appearance exceeds 4.5:1. Dark appearance uses
black text on the existing dark accent, but was not captured or claimed verified
before the user's stop request.

## Isolation and cleanup

The new real Claude provider plan fixture ran on stable staged BB at port
49486, in the staged Orbit workspace, with accept-edits permission. Its prompt
allowed only a fixed inert text response after approval and prohibited tools,
files, commands, network access and messages. The fixture remained pending while
captured. Both private source fallbacks, both simulator preference domains and
both installed app/group plists selected 49486 before first launch. The test
asserted the rendered Settings origin before navigation.

[Isolation](isolation.json), [pending before](pending-before.json),
[pending after](pending-after.json) and [cleanup](cleanup.json) retain this scope.
The raw xcresult remains in `/tmp/bb-current-diagnostic.6v09KU/interaction-results.xcresult`.
The device, thread and matching owned plan file are removed after export.
No further source changes or test iterations followed the stop request.
