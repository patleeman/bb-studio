# Artifact edge-case runtime checks

The native PDF viewer now parses document bytes with PDFKit before showing pages. An HTTP success, PDF MIME type, or `%PDF-` header alone no longer permits a blank preview. Unreadable documents show Retry and Share File. Password-protected documents explain that another app must unlock the file. HTML retains the artifact-specific WebKit viewer.

## Recorded evidence

The [baseline summary](baseline-summary.json) records one pass and 2 failures. The header-valid corrupt PDF remained [blank](baseline/header-pdf-opened.png). The delayed old-version response did not replace the selected text; that test failed later because it expected a Share-sheet Copy button. The [failure tree](baseline/share-failure-tree.txt) shows iOS 27 exposes Copy as a cell.

The [first run](first-run-summary.json) records 4 passes and 2 harness failures on the new PDF source. Healthy text, Markdown/source toggling, HTML, image and PDF passed. Readable PDF pages and pinch-to-zoom passed. Locked PDF messaging and Share passed. Initial lookup Retry passed after the proxy returned an actual HTTP 503 and then HTTP 200; [response provenance](first-run-events.jsonl) records both.

The corrupt-PDF test reached its error, retried, and opened Share, then failed because it checked Copy before the sheet finished presenting. The later fully presented sheet does offer Copy. The race test retained selected text after releasing the old response, then failed because iOS denied the test runner direct clipboard access (`PBErrorDomain` 13). A shell `simctl pbpaste` on that run's owned simulator UUID returned the exact newest text. The corrected harness reads only its own simulator clipboard through its private proxy.

The [narrowed result](verified-summary.json) passes both corrected tests. The delayed old response completes at the proxy after switching back to version 2. The visible preview stays on the newest text. `simctl pbpaste` reads the exact newest text from only the owned simulator. Share downloads the selected version's exact 28 bytes. The [provenance log](verified-events.jsonl) records matching clipboard and Share SHA-256 hashes. This establishes this text-version sequence, without claiming metadata generation coverage.

A fresh-copy rerun stopped before app launch when Swift timed out type-checking unrelated StudioHomeView code. The [compiler interruption](compiler-interruption.txt) remains recorded. The narrowed rerun uses the first successful private project snapshot, updated owned tests, another empty simulator, and fresh DerivedData. [Source verification](final-source-verification.json) confirms the current ArtifactView, ArtifactPDFPreview, and ArtifactWebPreview match the tested source after the concurrent rebase. It does not claim the whole app snapshot equals later unrelated commits.

The [PDF page](first-run/readable-pdf-pages.png), [zoomed page](first-run/readable-pdf-zoomed.png), [locked error](first-run/locked-pdf-error.png), and [HTML preview](first-run/html.png) were visually inspected.

The [final PDF Share check](pdf-share-summary.json) passes both corrupt and locked PDF workflows after waiting for the native Close control. Their fully presented [corrupt-file sheet](pdf-share/header-pdf-share.png) and [locked-file sheet](pdf-share/locked-pdf-share.png) were visually inspected. The earlier [dimmed transition](verified/header-pdf-share.png) remains recorded; its initial ActivityListView assertion alone was too early for a useful screenshot.

Across the focused runs, all 6 workflow tests now pass. This is combined coverage on matching artifact source, rather than one full all-green run. Both final private build-for-testing commands passed. [Cleanup verification](cleanup-verification.json) confirms all 63 owned fixture IDs were removed; no owned simulator or proxy remains. Raw first-run, narrowed, and PDF Share results are `/tmp/bb-artifact-edge.RQOtM0/results.xcresult`, `/tmp/bb-artifact-edge.XdKXhG/results.xcresult`, and `/tmp/bb-artifact-edge.LWSdl5/results.xcresult`.

## Repeat safely

```sh
BB_ARTIFACT_QA_SERVER_URL=http://127.0.0.1:49486 \
BB_DATA_DIR=/tmp/bb-studio-goal-staged/data \
apps/ios/docs/artifact-runtime/edge-cases/run.sh
```

The harness creates an empty simulator, copied project and private DerivedData. Both app and app-group defaults and container preferences target `http://127.0.0.1:49626` and are read back before launch. Both copied production fallback URLs also target that origin; the copied client rejects any other origin. XCTest verifies the visible Settings URL before opening artifacts.

The loopback proxy forwards only to the isolated staged BB on port 49486. It rejects writes. Seeders create owned fixture IDs in Orbit and assert ownership before removing or adding bytes. Cleanup deletes only those fixture IDs, the created simulator, and the owned proxy process. No existing device or user clipboard is used.

To repeat only selected checks, set `BB_ARTIFACT_QA_TESTS` to comma-separated test method names from `run.sh`; the runner rejects unknown names.

## Limits

These checks use small deterministic files on one iPhone 18 Pro simulator with iOS 27.0. PDF parsing currently runs on the main actor and retains downloaded bytes; this evidence makes no large-file performance claim. It does not cover physical devices, other Dynamic Type sizes, every PDF variant, all text-version races, or metadata reload races. The proxy holds and releases an old text response after switching back to the newest version; cancellation may prevent the old response from reaching the retired consumer. The assertions establish that the visible preview, Copy Text, and Share remain on the selected version for this sequence.
