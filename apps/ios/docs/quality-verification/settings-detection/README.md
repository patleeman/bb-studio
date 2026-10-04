# Settings element-detection investigation

The unidentified Settings finding is reproducible and remains unresolved.
No production UI source changed. No audit finding was excluded or waived.

## Reproduction and localization

On 3 October 2026, a newly created empty iPhone 18 Pro / iOS 27 simulator ran
only the opt-in `ReviewQualityUITests` methods below. Before any app launch,
both the app preferences and app-group preferences had `serverURL` set to
`http://127.0.0.1:49486`. The runner received the same `BB_QA_SERVER_URL`; both
methods also asserted the URL shown in Settings. No server setting, host
control, voice preview, or data-submission action was used.

`testSettingsElementDetectionAtDefaultText` ran twice. Both iterations failed
the unhandled native `.elementDetection` audit with:

> Potentially inaccessible text

The native complete issue description in both runs was:

> This element appears to display text that should be represented using the accessibility API.

XCTest supplied a complete Settings screenshot but no highlighted bounds,
element identity, or more specific description. The previous collected audit
also supplied `issue.element == nil`. The native screenshots, original issue
descriptions, accessibility trees, full test log, and activity records are
retained here.

`testSettingsDetectionAtScrollPositions` collected `.elementDetection` findings
at five scroll attempts and kept its final strict assertion. It failed with
two findings, both still unidentified:

| Attempt | Visible content relevant to localization | Detection reports |
| --- | --- | ---: |
| 0 | Initial Settings screen; concurrency stepper and host row visible | 1 |
| 1 | Server URL and most of Keep Mac awake have scrolled away; concurrency stepper and host row still visible | 1 |
| 2 | Lower Settings; concurrency stepper and host row have scrolled away | 0 |
| 3 | Same lower Settings viewport, already at its scroll limit | 0 |
| 4 | Same lower Settings viewport, already at its scroll limit | 0 |

This associates the report with the upper Hosts area. It does not identify
which element triggers the audit. The three lower attempts are repeat checks
of one viewport, not three independent layouts.

## What the accessibility API exposes

At attempt 0, the tree includes:

```text
Stepper, {{32.0, 460.3}, {338.0, 32.0}}, label: 'Threads at once, Automatic', value: 0
Button, identifier: 'Decrement', label: 'Threads at once, Automatic, Decrement', value: 0, Disabled
Button, identifier: 'Increment', label: 'Threads at once, Automatic, Increment', value: 0
StaticText, {{32.0, 466.2}, {236.0, 20.3}}, label: 'Threads at once, Automatic'
StaticText, {{32.0, 466.2}, {123.3, 20.3}}, label: 'Threads at once'
StaticText, {{16.0, 502.3}, {370.0, 52.0}}, label: "Patrick's MegaMac, 18 at once"
StaticText, {{32.0, 520.5}, {115.3, 15.7}}, label: "Patrick's MegaMac"
```

Attempt 1 exposes the same labels and actions at their scrolled positions.
Both `Automatic` and `18 at once` are therefore represented in full combined
labels. The native `LabeledContent`/Stepper composition also exposes overlapping
combined and partial text nodes. That duplication is a possible audit
interaction, not proof of an app defect. A VoiceOver or system-framework
reproduction would be needed before changing semantics or proposing an
exclusion. No custom-control clipping or missing-text defect was established
in this Settings-only investigation.

## Evidence and disposition

`build-for-testing` succeeded for both diagnostic methods. The two baseline
iterations and the localization test failed on the audit finding described
above. They are diagnostic reproductions, not passing accessibility gates.
The original navigation/row audit methods and their assertions are unchanged.
No Capture or unrelated fixture screenshot was collected in this lane.

| Evidence | Links |
| --- | --- |
| Native baseline, iteration 1 | [Settings screenshot](baseline-1-settings.png), [native issue screenshot](baseline-1-native-issue.png), [tree](baseline-1-accessibility-tree.txt), [description](baseline-1-issue.txt) |
| Native baseline, iteration 2 | [Settings screenshot](baseline-2-settings.png), [native issue screenshot](baseline-2-native-issue.png), [tree](baseline-2-accessibility-tree.txt), [description](baseline-2-issue.txt) |
| Localization, attempt 0 | [Screenshot](settings-detection-position-0.png), [tree](settings-detection-position-0-accessibility-tree.txt) |
| Localization, attempt 1 | [Screenshot](settings-detection-position-1.png), [tree](settings-detection-position-1-accessibility-tree.txt) |
| Localization, attempt 2 | [Screenshot](settings-detection-position-2.png), [tree](settings-detection-position-2-accessibility-tree.txt) |
| Localization, attempt 3 | [Screenshot](settings-detection-position-3.png), [tree](settings-detection-position-3-accessibility-tree.txt) |
| Localization, attempt 4 | [Screenshot](settings-detection-position-4.png), [tree](settings-detection-position-4-accessibility-tree.txt) |
| Original logs and activities | [Baseline log](https://github.com/patleeman/bb-studio/blob/321665bec62f1c351a85b78aee7b532243b63f7d/apps/ios/docs/quality-verification/settings-detection/baseline-run.log), [baseline activities](baseline-activities.json), [localization log](https://github.com/patleeman/bb-studio/blob/321665bec62f1c351a85b78aee7b532243b63f7d/apps/ios/docs/quality-verification/settings-detection/positions-run.log) |

Full local result bundles: `/tmp/bb-settings-detection-baseline.xcresult` and
`/tmp/bb-settings-detection-positions.xcresult`. Build logs:
`/tmp/bb-settings-detection-build.log` and
`/tmp/bb-settings-detection-localize-build.log`. XCTest's ancillary platform
diagnostic collector reported it could not locate `simctl`; the actual UI
audits, screenshots, trees, and result bundles completed and are retained.

The private simulator `A36475F6-229A-46CB-A11F-FD3090A42951` was shut down and
deleted after the run. No existing simulator or physical device was changed.
No production UI patch or audit waiver is justified by this evidence alone.

## Reproduce safely

Use the isolated fixture and fresh-simulator workflow in
[quality-verification.md](../../quality-verification.md). Before launching
the app or tests, install the built app without launching it, then get both
containers using `simctl get_app_container <new-simulator-id> nyc.plee.bbgo data`
and `simctl get_app_container <new-simulator-id> nyc.plee.bbgo group.nyc.plee.bbgo`.
Set `serverURL` to `http://127.0.0.1:49486` in both
`<app-data>/Library/Preferences/nyc.plee.bbgo.plist` and
`<app-group>/Library/Preferences/group.nyc.plee.bbgo.plist`. Confirm both values
before launch. Restrict the injected xctestrun file and `-only-testing` arguments
to the diagnostic method being reproduced, retain a new result-bundle path,
then shut down and delete only that new simulator.

Do not run the legacy UI suites, clone an existing simulator, or treat a
missing-environment skip as verification.
