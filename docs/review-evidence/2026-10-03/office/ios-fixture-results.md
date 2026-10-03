# Native assistant and audio fixtures

The two fixture-backed tests pass: **2 tests, 0 failures**.

- `ThreadUITests/testMessageSentTime`: opens a seeded assistant message and checks its sent-time menu.
- `ThreadUITests/testRecordingPlayback`: plays generated WebM/Opus and MP4/AAC recordings, crosses segment boundaries, skips forward and back, seeks from the transcript, changes speed, and verifies pause.

`apps/ios/scripts/seed-ui-fixtures.mjs` creates an inert completed assistant timeline and two three-segment, 90-second recordings. It runs only against an explicit loopback server and a temporary staged data directory, verifies the project in both, and reuses its generated IDs. Audio and completed transcript rows are seeded locally; no model or transcription job runs. The runner injects the generated IDs into the test environment. Hardcoded recording IDs are removed, and transcript seeking is now required rather than conditional.

Verified on the owned simulator `CF1B0476-6432-46CB-8EB3-255297208A71` against the six-plugin staged server at `http://127.0.0.1:52586` (`09bb66a` plugins), using the current native source plus these fixture changes. The simulator build and selected UI tests passed. A second seed invocation produced identical environment inputs. Node and shell syntax checks and `git diff --check` passed.

```sh
BB_TEST_SIMULATOR_ID=CF1B0476-6432-46CB-8EB3-255297208A71 \
BB_QA_SERVER_URL=http://127.0.0.1:52586 \
BB_QA_PROJECT_ID=proj_76wzbzwrth \
BB_QA_DATA_DIR=/tmp/bb-studio-stage9-complete/data \
BBGO_QA_THREAD=thr_pkzy5g43vb \
BB_UI_TEST_RUN_DIR=/tmp/stage9-native-fixtures \
BB_UI_TEST_ONLY=BBStudioUITests/ThreadUITests/testMessageSentTime \
apps/ios/scripts/ui-test.sh \
  -only-testing:BBStudioUITests/ThreadUITests/testRecordingPlayback
```

Local evidence: `/tmp/stage9-native-fixtures/results.xcresult` and `/tmp/stage9-native-fixtures/tests.log`. These are focused results, not a new full-suite pass. The separate UI worker owns the remaining failures and skips.

The [exact pre-restructure queue baseline](queue-baseline-exact.md) also confirms that queue removal's original assertion failure predates Office; no bisect was needed.
