# Settings control isolation and verified workaround

The unidentified element-detection finding was reproduced in a standalone
SwiftUI app, isolated to the Stepper composition, and removed from the real BB
Settings screen by moving the visible configured value into a separate row.
This closes this element-detection report only. No audit findings were waived,
and no other accessibility category is claimed to pass.

## Isolating experiment

The [harness](harness/) has no BB dependencies, networking, app-group storage,
host settings, or real server actions. Its controls use local `@State`; its URL
field displays the staged origin only. Each case runs the same unhandled native
`performAccessibilityAudit(for: [.elementDetection])`, retaining its screenshot
and full accessibility tree. No control is tapped or changed.

Fresh iPhone 18 Pro / iOS 27 simulator results, 3 October 2026:

| Case | Result | Evidence |
| --- | --- | --- |
| Original inline `LabeledContent` inside native Stepper | Fail: potentially inaccessible text | [PNG](matrix/minimal-baseline.png), [tree](matrix/minimal-baseline-accessibility-tree.txt) |
| Plain HStack Stepper label and explicit accessibility value | Same failure | [PNG](matrix/minimal-stepper.png), [tree](matrix/minimal-stepper-accessibility-tree.txt) |
| Plain combined host row | Same failure | [PNG](matrix/minimal-host.png), [tree](matrix/minimal-host-accessibility-tree.txt) |
| Both simplifications | Same failure | [PNG](matrix/minimal-both.png), [tree](matrix/minimal-both-accessibility-tree.txt) |
| Toggle alone | Pass | [PNG](isolation/minimal-toggle-only.png), [tree](isolation/minimal-toggle-only-accessibility-tree.txt) |
| Host LabeledContent alone | Pass | [PNG](isolation/minimal-host-only.png), [tree](isolation/minimal-host-only-accessibility-tree.txt) |
| Empty controls section, same surrounding Form content | Pass | [PNG](isolation/minimal-empty.png), [tree](isolation/minimal-empty-accessibility-tree.txt) |
| Inline Stepper alone | Same failure | [PNG](isolation/minimal-stepper-only.png), [tree](isolation/minimal-stepper-only-accessibility-tree.txt) |
| Standard titled Stepper without inline value | Pass | [PNG](standard/minimal-standard-stepper-only.png), [tree](standard/minimal-standard-stepper-only-accessibility-tree.txt) |
| Standard titled Stepper, explicit value, separate value row | Pass | [PNG](standard/minimal-separate-stepper-only.png), [tree](standard/minimal-separate-stepper-only-accessibility-tree.txt) |

The failing variants already expose their values through the accessibility API.
This therefore establishes a composition workaround; it does not prove a
particular defect inside Apple's framework or a missing product label. Replacing
the host row did not help, so the product host row remains unchanged.

## Product change and verification

`ServerControls.swift` now uses the standard titled Stepper and exposes its
configured limit as `accessibilityValue`. A separate `Configured limit` row
shows the same `Automatic` or numeric string. The existing Binding, asynchronous
save action, range `0...32`, and conversion of zero to an automatic limit are
unchanged. No host limit or keep-awake setting was changed during verification.

The real BB Settings element-detection test passed at default and accessibility
XXXL text. The separate scrolled-row element-detection check also passed. Its screenshot
partly obscures the value behind the floating tab bar, so full-value visibility
remains unverified. The first attempt used an exact child label and failed
before the audit; a corrected combined-label query passed without a source
change. These runs used a second newly created empty simulator and a private
BB source copy. Both private
fallback URLs, actual app preferences, and actual app-group preferences were
set and verified as `http://127.0.0.1:49486` before launch. Only the intended
opt-in Settings diagnostics were compiled/run; older UI suites were removed
from the private copy. Production fallback URLs were not changed.

The default value row is explicitly `.foregroundStyle(.primary)`. Its rendered
`Automatic` glyphs are `RGB(0,0,0)` on `RGB(255,255,255)`: **21:1 contrast**,
so the previous small-value contrast defect was not reintroduced. The default
tree exposes:

```text
Stepper, label: 'Threads at once', value: Automatic
Button, identifier: 'Decrement', label: 'Threads at once, Decrement', value: Automatic, Disabled
Button, identifier: 'Increment', label: 'Threads at once, Increment', value: Automatic
StaticText, label: 'Configured limit, Automatic'
```

[Default product screenshot](product/settings-detection-default.png) and
[full tree](product/settings-detection-default-accessibility-tree.txt).
[Initial accessibility XXXL screenshot](product/settings-detection-accessibility-xxxl.png)
and [tree](product/settings-detection-accessibility-xxxl-accessibility-tree.txt).

## Reproduce and limits

Copy `harness/` into a new private temporary directory, run `xcodegen generate`
there, and build/test scheme `MinimalSettings` on a newly created empty
simulator. The ten named tests select their local variant with `-controlCase`.
The five failing cases are expected diagnostic failures, not passing tests.
Builds succeeded. No BB installation or server is needed for the harness.

Logs are retained in [matrix](https://github.com/patleeman/bb-studio/blob/321665bec62f1c351a85b78aee7b532243b63f7d/apps/ios/docs/quality-verification/settings-minimal/matrix/run.log), [isolation](https://github.com/patleeman/bb-studio/blob/321665bec62f1c351a85b78aee7b532243b63f7d/apps/ios/docs/quality-verification/settings-minimal/isolation/run.log),
[standard](https://github.com/patleeman/bb-studio/blob/321665bec62f1c351a85b78aee7b532243b63f7d/apps/ios/docs/quality-verification/settings-minimal/standard/run.log), and [product](https://github.com/patleeman/bb-studio/blob/321665bec62f1c351a85b78aee7b532243b63f7d/apps/ios/docs/quality-verification/settings-minimal/product/run.log). Full local bundles:
`/tmp/bb-settings-minimal-matrix.xcresult`,
`/tmp/bb-settings-minimal-isolation.xcresult`,
`/tmp/bb-settings-minimal-standard.xcresult`, and
`/tmp/bb-settings-minimal-product.xcresult`. Full exported native attachments
remain in the corresponding `/tmp/*-attachments` directories; this folder
curates named screenshots and trees instead of duplicating UUID screenshots.

No VoiceOver, physical-device, dark-mode, contrast-audit, Dynamic Type audit,
text-clipping audit, or overall accessibility pass is claimed. Existing strict
navigation assertions and unresolved findings are unchanged.

The scrolled accessibility XXXL value row passed element detection and its
combined label was reachable. [Screenshot](product-row/settings-configured-limit-accessibility-xxxl.png),
[tree](product-row/settings-configured-limit-accessibility-xxxl-accessibility-tree.txt),
[passing log](https://github.com/patleeman/bb-studio/blob/321665bec62f1c351a85b78aee7b532243b63f7d/apps/ios/docs/quality-verification/settings-minimal/product-row/passed-run.log), and
[initial query failure](https://github.com/patleeman/bb-studio/blob/321665bec62f1c351a85b78aee7b532243b63f7d/apps/ios/docs/quality-verification/settings-minimal/product-row/run.log). The first attempt failed
`XCTAssertTrue(configured.exists)` before any audit because it searched for an
exact `Configured limit` child. The corrected query matches the observed
combined label `Configured limit, Automatic`; no production change was needed.
The retained screenshot shows the bottom of `Automatic` partly behind the
floating tab bar. Full-value visibility was not asserted, so this is not a
text-clipping or complete large-text layout pass. Bundle:
`/tmp/bb-settings-minimal-product-row2.xcresult`. Both private simulators were
shut down and deleted; the borrowed scratch source/build directory is released.
