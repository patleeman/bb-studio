# Cancel Page reloads when their view closes

A real page-content change schedules `PageModel`'s 600 ms reload. Previously,
`detach()` removed the realtime listener but left that task alive. The queued
closure retained the model and started a Markdown API read after the view closed.
`detach()` now cancels and clears only that reload task. Page save and recovery
paths are unchanged.

## Focused native regression

The test uses the real `PageModel`, `AppModel`, and `BBRealtime` connection to
staged BB at `http://127.0.0.1:49486`. It creates one owned page and edits its
Markdown through the real Pages API. After receiving the actual page-change
signal, it waits 100 ms, detaches, and removes its strong model reference.

An existing `BBClient.transport` hook records Markdown API-read attempts and
holds each read for two seconds. This makes post-detach work and retention
observable without adding a production test API. The read is intercepted before
network transmission; event delivery and fixture edits use the real server.

The pre-fix run failed both assertions: the weak model remained alive after a
100 ms yield, and one queued Markdown read started after detach. The fixed run
passed: the weak model was nil after that yield and no read started during the
following second. Cancellation is cooperative: the immediate log can still show
retention before the cancelled task resumes. The later assertion is the release
check. A positive attached control receives another real content change and
starts exactly one read, proving live reloads still work while attached.

Evidence: [before log](before.log), [before summary](before-summary.json),
[after log](after.log), and [after summary](after-summary.json). The fixed native
build and regression passed on 3 October 2026, Debug / iPhone 18 Pro / iOS 27.0.
Local bundles: `/tmp/bb-native-performance/detach/repro.xcresult` and
`/tmp/bb-native-performance/detach/after.xcresult`.

The first exploratory metadata-update attempt did not emit the required content
signal. It is excluded from the lifecycle result. A missing signal or connection
fails the test rather than counting as cancellation success.

## Reproduce

With the isolated staged server running:

```sh
BB_DETACH_QA_SERVER_URL=http://127.0.0.1:49486 \
  bash apps/ios/docs/native-performance/detach/reproduce.sh
```

The runner creates an empty private simulator and a private source copy. It
replaces both fallback origins and sets both app and app-group preferences
before the hosted native test launches the app. Only this native test is selected;
legacy UI suites do not run. The fixture-ID cleanup runs even if the test fails,
then the runner deletes only its private simulator. The checked-in test lives
with this evidence and is copied into the temporary unit-test target, avoiding
an ordinary hosted test launch against default app settings.

This is a controlled lifecycle regression, not a physical-device memory,
battery, latency, or long-session leak measurement.
