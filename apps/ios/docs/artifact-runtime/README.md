# Native artifact preview runtime checks

The Office suite now runs all 12 artifact cases through
`apps/ios/scripts/ui-test.sh` when `BB_QA_DATA_DIR` is provided. It uses the
configured staged project and consolidated Studio API, seeds readable and
unavailable content, and starts an owned loopback proxy on a free port. The
proxy controls initial lookup failure and delayed version responses, records
clipboard/share verification, and allows restoration writes only for its fixture
payloads. It is stopped on runner exit. Use
`BB_UI_TEST_ONLY=BBStudioUITests/ArtifactRuntimeUITests` for a focused run.

The fixed ports and paths below describe the earlier review evidence.


The later [edge-case follow-up](edge-cases/README.md) verifies header-valid corrupt
PDFs, password-locked PDFs, native PDF rendering/zoom, initial lookup Retry, and
a controlled delayed text-version response. PDF previews now use PDFKit; HTML
keeps the artifact-specific WebKit viewer. The runs below describe the earlier
WebKit-based checkpoint and retain its before/after evidence.

Verified on 3 October 2026 against the isolated staged BB at `http://127.0.0.1:49486`, project Orbit (`proj_su3dznrbpw`). The app runs in a newly created, empty iPhone 18 Pro simulator on iOS 27.0, with a private copied project and derived data. Both app and app-group preferences were set and read back before launch. The copied `AppGroup.swift` and `BBClient.swift` also replace the production fallback URL with the staged URL. XCTest checks the visible Settings URL before opening any artifact.

This is SwiftUI text/Markdown, AsyncImage, and WebKit coverage. It does not use or test QuickLook. No user server, existing simulator, phone, other agent's fixture, or legacy UI suite was used.

## Reproduced failures and fixes

- Missing text bytes silently showed the generic file/Share fallback. Text now reports an unavailable preview and offers Retry. An empty string remains valid.
- Missing or corrupt image bytes showed a label without Retry. The image failure view now offers Retry and Share. Its error controls sit outside the image's two-axis scroll view; an intermediate screenshot caught clipped error text inside that scroll view.
- Corrupt PDF bytes produced a blank WebKit view. `ArtifactWebPreview.swift` handles unsupported MIME responses, HTTP failures, navigation failures, and a terminated WebKit process. It offers Retry and Share through ArtifactView. The shared `App/WebView.swift` is unchanged.
- Text completions check cancellation and the selected version before updating state. Starting a request clears its previous version marker. Copy Text and the Markdown source toggle require text from the current version. WebKit callbacks check retirement, request generation, and navigation identity; dismantling removes the delegate and cancels loading.

## Recorded runs

[Baseline summary](baseline-summary.json): 4 tests passed in 177 seconds. The baseline suite asserts the defective behavior to establish reproduction; this is not a correctness pass. It records valid text, Markdown/source toggling, HTML, image and PDF, plus missing text/image and corrupt image. Visual inspection found the corrupt PDF blank surface in the [baseline screenshot](baseline/corruptPDF.png).

[First recovery summary](first-recovery-summary.json): 2 of 3 tests passed. Text recovered after restoring its owned bytes and tapping Retry. Image Retry removed its error, but the assertion failed because the remote SwiftUI image was absent from the accessibility tree. The [failure tree](intermediate/first-recovery-image-failure-tree.txt) retains that result. Its error screenshot also exposed clipped text inside the two-axis scroll view.

[Intermediate summary](intermediate-summary.json): 6 of 7 tests passed. Text and HTML recovery, valid formats, empty text, and corrupt PDF handling passed. The missing-image test failed before Retry: reopening the previously restored immutable URL showed image content instead of the expected missing-file error. Retained caching is the likely cause. The final run seeds fresh artifact IDs so this setup cannot inherit the previously restored URL. The final source names the successful image container; its test independently checks the restored PNG's distinctive blue pixels. Both failed attempts remain recorded.

[Final verified summary](verified-summary.json): **7 tests passed, 0 failures**, in 192 seconds on the exact source recorded in [source fingerprints](source-sha256.txt). The private build-for-testing also passed. Screenshots and accessibility trees are in [verified/](verified/).

| Check | Final result and evidence |
| --- | --- |
| Text, Markdown/source toggle, HTML, PNG and PDF | Pass; [PDF pixels](verified/pdf.png), [HTML](verified/html.png), [PNG](verified/image.png) visually inspected |
| Empty text | Pass; valid empty preview retains Copy Text |
| Missing text | Pass; unavailable message, reachable controls, restored bytes plus Retry show [recovered text](verified/recovered-text.png) |
| Missing image | Pass; reachable controls, restored bytes plus Retry show [recovered PNG](verified/recovered-image.png); both blue-pixel assertion and named accessibility element pass |
| Missing HTML | Pass; HTTP 404 becomes an error, restored bytes plus Retry show [recovered HTML](verified/recovered-html.png) |
| Corrupt PNG | Pass; error and recovery actions remain available |
| Corrupt PDF | Pass; [error and reachable actions](verified/corrupt-pdf-error.png) replace the [baseline blank view](baseline/corruptPDF.png); Retry keeps the honest unsupported-content error |

The image failure [now wraps within the phone width](verified/missing-image-error.png). The initial [clipped intermediate layout](intermediate/missing-image-error.png) remains as evidence. Image Retry remounts the native loader; no cache-busting query was needed in the live missing-blob restoration check.

Raw private results: `/tmp/bb-artifact-runtime/verified.xcresult`; build log: `/tmp/bb-artifact-runtime/verified-build.log`; XCTest log: `/tmp/bb-artifact-runtime/verified-test.log`. Source began from ArtifactView SHA-256 `99797d2a5a0624014d33b4a50ddeea195e884419db0053a461fe284c880264c0`; repository HEAD during baseline was `78e80b745398df7d91021ec9082f29d2890f0daf`. Native source changes are local to ArtifactView and the new artifact-specific web preview. All owned fixture IDs and the private simulator were deleted after exporting evidence.

## Repeat safely

A later source review added Retry to the initial artifact lookup error as well.
It clears the error immediately and repeats the lookup through the view's
captured server client. The seven UI tests above exercise content preview
failures after lookup. The [edge-case follow-up](edge-cases/README.md) now verifies
initial-lookup recovery from a controlled HTTP 503 to a successful retry.

The opt-in suite refuses to launch without the exact staged origin, a private-simulator marker, and owned fixture JSON. `run.sh` copies the project, includes only ArtifactRuntimeUITests, creates a new device, seeds its own artifact IDs, verifies preferences, and removes only its own device and artifact IDs on exit. `seed.py` removes bytes only after confirming the blob has exactly the owned fixture reference. It never alters another artifact.

```sh
BB_ARTIFACT_QA_SERVER_URL=http://127.0.0.1:49486 \
BB_DATA_DIR=/tmp/bb-studio-goal-staged/data \
apps/ios/docs/artifact-runtime/run.sh
```

The script prints its private results directory. The recorded runs used the same commands individually during reproduction and refinement; the packaged runner has shell/Python syntax checks, not a separate end-to-end rerun.

## Limits

This earlier checkpoint uses one default-size iPhone simulator and simple deterministic files. It does not cover physical-device performance, other Dynamic Type sizes, every format or encoding, a corrupt PDF that still has a valid `%PDF-` header, or all linked-resource behavior. The stale-completion guards are reviewed code changes; this lane did not inject a controlled delayed version response or prove every version-switch race. WebKit process termination and network-disconnection callbacks are compiled but were not separately forced. PDF/image rendering is also inspected in screenshots; text and HTML recovery have live content assertions.

The [later follow-up](edge-cases/README.md) closes the header-valid corrupt PDF,
locked PDF, initial lookup retry and one delayed text-version sequence gaps.
Large-file performance, physical devices and metadata reload races remain
unverified; the newer report records its precise source and coverage limits.
