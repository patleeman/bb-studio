# Office UI retargeting: full run and follow-ups

The full UI suite ran against isolated stable BB at `http://127.0.0.1:52586`,
using private simulator `CF1B0476-6432-46CB-8EB3-255297208A71`.
It includes the Team navigation fixes (`c47f355`, `1bf08d1`).

**90 tests: 23 passed, 55 skipped, 12 failed.**
[Exact failures](ios-ui-retarget-full.json).
Raw bundle: `/tmp/stage9-retarget-full/results.xcresult`.
This build predates the automation timestamp fix and later native remediation;
it is not a final green run of those later commits.

## Retargeted coverage

`d940a521` records the three replacements, preserving supported behavior:

- Bots open from Team into their desk, Tasks, and Profile. The test also checks
  the legacy bot deep link and exclusion of bots/conversations from Work.
- Scratch channels open from Team Conversations. Rename, add a member, archive,
  and restore are verified against persisted state; teardown removes the channel.
- Automation coverage uses the current host editor: create, Once schedule,
  pause/resume, rename, and API deletion. Retired room modes, channel permissions,
  and channel automation RPCs no longer exist. No bot message is sent.

Channel management passed in the full run. The bot test initially failed on a
combined accessibility label; after correction it passed in
`/tmp/stage9-retarget/results.xcresult` (1 test, 0 failures).
The automation test exposed fractional `runAt` milliseconds; the coordinator
fixed the client in `3e705659`. The separate worker's focused verification of
bot and automation tests passed in `/tmp/office-retarget-verified-2/results.xcresult`.
See [remediation evidence](ios-ui-progress.md).

## Remaining results

Five of the full run's twelve failures have subsequent focused fixes or passes:

| Test | Follow-up |
|---|---|
| Bot in Studio | Correct combined trust label; Team/desk test passes |
| Channel automations | Integer timestamp client fix; focused test passes |
| Queue removal | Actual server deletion succeeded; stale accessibility row fixed in `629d48f6` |
| Quick capture | Retired plugin ID gate fixed in `5a5170f1`; focused test passes |
| Item chat | Retired plugin ID gate and cold-start preference handling fixed in `5a5170f1`; focused test passes |

Seven failures remain unresolved by the recorded focused checks:

- `testMessageSentTime`: expects a sent assistant message/menu absent from this seed.
- `testRecordingPlayback`: references recordings absent from this seed.
- `testTools`: expects a Daily fixture absent from this seed.
- `testStudio`: Drawings button lookup fails in its collection flow.
- `testStudioBulk`: Rename Tag menu lookup fails.
- `testThreadExtras`: Files & changes menu lookup fails.
- `testPluginStatusAndWorkspaceChoices`: plugin status passes, but the New thread
  navigation bar does not appear after `bbstudio://new`.

The last four need UI/selector triage before classifying them as product bugs.
The 55 skips remain fixture/device guards, not successful workflow coverage.
A full suite against all later remediation commits has not been claimed here.
