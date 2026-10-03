# Native audit policy evidence

This is interim evidence, not a passing full-suite report. The coordinator
approved specific native contrast exclusions. Every other native finding still
fails the test; no exclusion uses a test name as its condition.

| Test / capture | Element | Reason | Evidence |
| --- | --- | --- | --- |
| `testStudioRowContrastNativeDiagnosticAtAccessibilityText` | `studioSelect`, label Select, inside the navigation bar | Policy 3: rendered contrast independently exceeds 4.5:1 | [Element screenshot](select-contrast.png); sampled sRGB foreground 0, background 249, ratio **19.9461:1**; frame `(310.3333, 66, 71.6667, 36)` |
| `testNavigationAtDefaultText`, note screen | `captureNoteSave` | Policy 1: identifier matches and `isEnabled == false` | [Disabled-note screenshot](disabled-note.png); frame `(23.3632, 447.6733, 355.2736, 48.3300)` |

The pixel sampler converts the control screenshot to sRGB, excludes the outer
10% on each axis to avoid its glass border/shadow, requires substantial neutral
foreground and light background populations, and measures the median dark
foreground against the lower fifth percentile of the light background. A
non-monochrome or insufficient sample fails closed. Tests verify 21:1 black on
white, gray below 4.5:1, and rejection of a lone dark pixel. The coordinator subsequently extended policy 3 to any resolved element. The
sampler still rejects insufficient or non-neutral samples, requires a nonempty
label and a frame wholly inside the app, and keeps its screenshot and measured
ratio. A four-channel-value tolerance admits the slight tint in system fills;
the required contrast remains 4.5:1. It is not a general color contrast audit.

Policy 2 now uses the coordinator-approved scroll and reaudit proof. A contrast
finding is eligible only if its resolved frame intersects a queried native bar,
lies below the bottom bar's top, or the issue has no resolved element. The test
retains both screenshots and audit results, reaches the end of the scroll view,
and requires all original eligible issues to disappear without any new contrast
issue. Otherwise it keeps the failure. The public issue object has no standalone
frame, so no guessed region or private API is used.

The Home labels required a product change, not an exclusion: their icons and
wrapped text now have separate layout space. The strict native text-clipping
test passes. These screenshots are exact crops `(48,453,1158,1400)` from the
before/after native screenshots, with no other pixel changes.

| Before | After |
| --- | --- |
| ![Home actions before](home-before.png) | ![Home actions after](home-after.png) |

Runs:

- `/tmp/office-audit-policy/results.xcresult`: sampler and strict Home clipping
  tests pass; Studio contrast still fails on a separate, unsuppressed material
  finding after verifying Select.
- `/tmp/office-audit-navigation/results.xcresult`: the disabled-note exclusion
  is exercised; navigation still fails on the remaining audit findings.
- `/tmp/office-contrast-sampler/results.xcresult`: final sampler regression check.

The final report must record the exclusions from the final full run, including
its actual ratios and screenshot paths; these intermediate values do not prove
that run passed.

## Semantic controls and independent OCR

The coordinator approved semantic label colors for Settings section headers,
primary semibold SpaceMark text on tertiarySystemFill, and Large Content Viewer
support for fixed Capture, Studio Select and Space switcher toolbar controls.
Standard and secondary headers still rendered too faint in iOS 27; explicit
`UIColor.label` cleared the header findings away from native material edges.
The fixed controls still require a verified Large Content Viewer gesture before
any dynamic-type exception can be applied. No such exception is present yet.

The new OCR evidence test recognizes Capture labels independently at default and
accessibility XXXL sizes. It disables language correction, supplies no expected
words to Vision, requires exact text without ellipses at confidence >= 0.95, and
maps recognized glyph bounds into the containing control's exact screen frame.
It retains label and whole-control crops. The extra AX label-box containment
check allows only 1/1024 point for Float32/CGFloat conversion noise; the glyph
containment proof has no tolerance. OCR evidence does not yet suppress native
clipping findings.

The [Space mark crop](space-mark-contrast.png) comes from the real screenshot at
queried frame `(132.6667, 74, 20, 20)` in
`/tmp/office-semantic-contrast/results.xcresult`. Its black text against approximately
RGB(228,228,230) measures about 16.5:1. The runtime sampler records its own more
conservative value whenever that exclusion is actually exercised.

Focused validation:

- `/tmp/office-controls-proof/results.xcresult`: Home contrast passes. The request
  body originally intersected the tab bar, then disappeared from the contrast
  audit after scrolling. The only retry finding was SpaceMark, independently
  verified at **17.2969:1** (foreground 0, background 233). See the
  [before](home-material-before.png), [after](home-material-after.png),
  [runtime SpaceMark crop](space-mark-runtime.png), and
  [initial/retry result record](home-material-reaudit.txt).
- The same run keeps Settings contrast failing: Threads/Plugins remain at the
  upper system material edge. No broad exclusion was added for those findings.
- `/tmp/office-verified-controls/results.xcresult`: the sampler's black/white,
  low-contrast gray and sparse-dark-pixel rejection checks pass.
- `/tmp/office-ocr-visible/results.xcresult`: the Capture OCR test passes for all
  four reported labels at both default and accessibility XXXL. Every recognized
  line has confidence **1.0**, exact text, no ellipsis and glyph bounds inside its
  control. [Retained label/control crops and observation records](capture-ocr/)
  include the New thread control scrolled fully into view. The previous helper
  stopped when a partly visible control was hittable; it now requires the whole
  control to be visible before taking evidence.
