# Native contrast follow-up, 3 October 2026

The app's small secondary text had insufficient contrast in the original light
screenshots. Settings section headings and explanatory footers, Studio day
headings and row metadata, Today headings and activity timestamps, and the
Settings concurrency value now use `Color.primary.opacity(0.75)`. Font sizes,
navigation, data operations, and the existing adaptive layouts are preserved.
The color follows the system's primary light/dark color; this run verifies light
mode only.

## Verified improvement

Measurements use solid glyph pixels and the adjacent background from the
unaltered 1206 × 2622 simulator PNGs, excluding antialiased edge pixels. The
ratios use linearized sRGB relative luminance.

| Text sample | Original pixels / background | Original contrast | Follow-up pixels / background | Follow-up contrast |
| --- | --- | --- | --- | --- |
| Settings server explanation | `133,133,139` / `242,242,247` | 3.29:1 | `61,61,62` / `242,242,247` | 9.72:1 |
| Studio row metadata | `127,127,127` / `255,255,255` | 4.00:1 | `64,64,64` / `255,255,255` | 10.37:1 |
| Today activity timestamp | — | — | `64,64,64` / `255,255,255` | 10.37:1 |

The rerun reports no default-size small-text contrast finding in Settings,
Studio, or Today. Settings at accessibility XXXL still reports no finding.

## Strict rerun remains failing

`build-for-testing` succeeded. The three selected `ReviewQualityUITests`
navigation/row methods reached their final audit assertions and failed there.
All named-action, reachability, minimum-frame, and empty-note-disabled checks
completed before those assertions. The audit assertion and issue handler were
unchanged. No findings were waived or excluded.

The run used a newly created empty iPhone 18 Pro / iOS 27 simulator and exactly
`BB_QA_SERVER_URL=http://127.0.0.1:49486`. Only the isolated review methods ran;
neither the older suites nor production endpoints were used. The simulator was
shut down and deleted after attachment export.

| Screen | Earlier reports | Follow-up reports |
| --- | ---: | ---: |
| Settings, default | 11 | 6 |
| Settings, accessibility XXXL | 0 | 0 |
| Studio, default | 10 | 3 |
| Studio, accessibility XXXL | 2 | 4 |
| Today, default | 7 | 4 |
| Today, accessibility XXXL | 2 | 2 |
| Capture, default | 6 | 6 |
| Capture, accessibility XXXL | 5 | 5 |
| Note, either size | 3 each | 3 each |
| Scrolled Studio row, accessibility XXXL | 3 | 2 |
| Total | 52 | 38 |

The staged fixture was shared with other isolated QA lanes. Its items changed
during the run: the large-text Studio screenshot includes an imported artifact,
while the default Studio screenshot includes the Tasks board. These totals are
observations, not a controlled claim that this patch resolved 14 defects.
The pixel measurements above establish the specific contrast improvement.

## Findings still requiring triage

- `Select` and `Close` report contrast and Dynamic Type failures; `Back` reports
  a Dynamic Type cap. They are standard SwiftUI toolbar buttons and appear as
  black text on pale glass in the screenshots. The screenshot does not support
  a text-contrast defect, but it does not prove the complete system audit wrong.
- Disabled `Save note` reports contrast and clipping at both sizes. The empty
  note is correctly disabled, and its complete label is visible. Enabled-state
  contrast and filled-note behavior were not measured by this read-only run.
- Capture reports clipping for `Record voice`, `Dictate`, and `Photo or file`
  at accessibility XXXL, and `Record voice`, `Dictate`, `Photo or file`, and
  `New thread` at default size. The screenshots show complete visible labels;
  the bottom large-text option is partially outside the scroll viewport and
  remains reachable by scrolling. No clipping exclusion was added.
- Settings default reports two unidentified contrast issues, one unidentified
  element-detection issue, and Dynamic Type findings for `Keep Mac awake`,
  `Threads at once`, and `Patrick's MegaMac`. The new unidentified detection
  finding needs follow-up; it is not classified as harmless. The retained tree
  includes the stepper's full `Threads at once, Automatic` label and both
  increment/decrement actions, and includes the host's effective limit.
- Today default reports Dynamic Type findings for `Tasks` and `Activity`, plus
  clipping for `Tasks` and `Review the launch checklist`. The visible default
  labels are complete. Today accessibility XXXL retains unidentified contrast
  and clipping findings. Studio accessibility XXXL reports two unidentified
  contrast findings in addition to `Select`; their elements are not supplied.
- The scrolled Studio row has no text-clipping finding. Its two remaining
  findings concern `Select` contrast and Dynamic Type. Studio default retains
  the system `UISearchBarTextField` clipping report.

No hit-region or insufficient-description finding was reported. This is not a
VoiceOver, physical-device, dark-mode, or full accessibility pass. No system
finding has a supported exclusion approved in this change.

## Evidence

The earlier screenshots and raw findings remain unchanged. Follow-up screenshots
and full accessibility trees are in [native-contrast-followup](native-contrast-followup/).
All 38 raw reports are in [audit-findings.txt](native-contrast-followup/audit-findings.txt).

| Surface | Default | Accessibility XXXL |
| --- | --- | --- |
| Settings | [PNG](native-contrast-followup/settings-default.png) | [PNG](native-contrast-followup/settings-accessibility-xxxl.png) |
| Studio | [PNG](native-contrast-followup/studio-default.png) | [PNG](native-contrast-followup/studio-accessibility-xxxl.png) |
| Today | [PNG](native-contrast-followup/today-default.png) | [PNG](native-contrast-followup/today-accessibility-xxxl.png) |
| Capture | [PNG](native-contrast-followup/capture-default.png) | [PNG](native-contrast-followup/capture-accessibility-xxxl.png) |
| Note | [PNG](native-contrast-followup/note-default.png) | [PNG](native-contrast-followup/note-accessibility-xxxl.png) |

[Scrolled Studio row PNG](native-contrast-followup/studio-rows-accessibility-xxxl.png).
Full result bundle: `/tmp/bb-native-contrast.xcresult`. Build log:
`/tmp/bb-native-contrast-build.log`. Test log: `/tmp/bb-native-contrast-test.log`.
Exported original attachments: `/tmp/bb-native-contrast-attachments`.
