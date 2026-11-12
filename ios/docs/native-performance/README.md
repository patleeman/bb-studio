# Isolated native navigation measurements

This review uses the real iOS app against staged BB at `http://127.0.0.1:49486`.
It exercises Studio list scrolling and Page open, content load, scroll, and back.
Twenty-four small, deterministic pages provide a list longer than one screen.
The test requires visible fixture rows to change after each list swipe. It checks
the page title and loaded Markdown before returning to Studio.

The suite runs five measured iterations of two navigation cycles each. XCTest's
warm-up also exercises the same actions. Memory and CPU metrics target the app,
rather than the UI-test runner. The test records completed cycles in its log.
There is no performance threshold or approved device baseline yet.

## Reproduce

Start the staged stable BB fixture at port 49486. Then run:

```sh
BB_PERFORMANCE_QA_SERVER_URL=http://127.0.0.1:49486 \
  bash apps/ios/docs/native-performance/reproduce.sh
```

The script creates an empty private iPhone 18 Pro / iOS 27 simulator. It copies
the app into a private temporary directory and builds Debug with Xcode 27. It
replaces both fallback server URLs in that copy before building. Both app and
app-group preferences receive the staged URL before the first launch. The test
also asserts the URL rendered in Settings before opening Studio.

Only `ReviewPerformanceUITests` is included in the copied UI-test target.
The runner must receive the exact staged URL and `BB_PERFORMANCE_QA_PRIVATE_SIM=YES`.
The script first runs without the URL opt-in; that run must skip before launch.
A skip is a safety check, not a successful performance measurement.

The script retains its result bundles and logs in its printed temporary folder.
Its cleanup removes only the fixture page IDs it created and its private
simulator. It does not restore a production/default URL anywhere.

Set `BB_PERFORMANCE_QA_LIFETIME=YES` to run a separate short lifetime check.
It adds init/release logging to `PageModel` only in the temporary source copy,
then runs one measured iteration plus warm-up. Its metrics are excluded from
the clean run. It exports those simulator logs as `page-lifetime.json`.

## Results, 3 October 2026

The clean run passed: 12 completed navigation cycles, five measured samples,
252.705 seconds for the full test. The missing-opt-in run skipped before any
application launch. Xcode 27.0 (27A266a) built Debug for a fresh iPhone 18 Pro /
iOS 27.0 (24A434) simulator. Other native builds and QA sessions shared the host.

Each measured block performs two verified navigation cycles:

| App metric | Five samples | Mean |
| --- | --- | --- |
| Peak physical memory, kB | 116492.832, 116427.296, 116083.232, 115935.776, 115984.928 | 116184.813 |
| Physical memory growth, kB | +360.448, −196.608, −278.528, +98.304, +49.152 | +6.554 |
| App CPU time, seconds | 16.367, 16.577, 16.412, 16.007, 17.043 | 16.481 |
| UI-test clock time, seconds | 37.593, 38.129, 38.017, 37.328, 38.205 | 37.854 |

Growth totals +32.768 kB across the ten measured cycles. Absolute physical
memory at each block's end stays between 112118.304 and 112593.440 kB, with the
final sample at 112265.760 kB. This sequence shows no sustained memory growth.
Accessibility querying and automation contribute to both CPU and clock values;
these values do not isolate the cost of ordinary user navigation.

Raw evidence: [metrics](metrics.json), [result summary](summary.json), and
[refusal summary](refusal-summary.json). The local result bundle is
`/tmp/bb-native-performance/performance-final.xcresult`; its complete UI trace
and attachments are retained there. The clean run used no active profiler.
An earlier 4.895-second Allocations attachment ended when a harness failure
terminated the app. It is too short to support a lifetime conclusion.

The separate lifetime run passed four navigation cycles. Copy-only logs show
four `PageModel` initializations and four releases, each before the next cycle
and before app termination. All four open the same deterministic page; this
checks ordinary repeated navigation, not retention after a page-save event.
Evidence: [lifetime events](page-lifetime.json) and
[lifetime result summary](lifetime-summary.json). The instrumented run's memory
and CPU measurements are excluded from the table above.

## Interpretation

[Apple's memory metric](https://developer.apple.com/documentation/xctest/xctmemorymetric)
observes physical memory during the measured block. Its result includes memory
growth, which is a bounded observation across these navigation cycles.
[Apple's CPU metric](https://developer.apple.com/documentation/xctest/xctcpumetric)
records CPU time executing in the target app. UI-test clock time also includes
automation, assertions, server requests, and wait-for-idle behavior.

Other QA builds and simulator sessions share the host. These samples cannot
establish physical-device latency, battery use, thermal behavior, dropped frames,
or a causal comparison with another build. A stable short sequence does not
prove that every object is released or that an hours-long session cannot leak.

A later [focused detach regression](detach/README.md) confirmed that a queued
realtime reload retained `PageModel` and started an API read after detach.
`PageModel.detach()` now cancels and clears that task. The fixed regression also
verifies that content changes still reload while the model remains attached.
