# Automation create: stable contract and baseline

The Once validation bug predates the Office restructure. At `e81d75b`,
`AutomationEditor.trigger` multiplied a `Date` by 1,000 without rounding.
Stable BB 0.45.0 requires `trigger.runAt` to be a positive integer.
The current `createAutomation` request's other fields match the stable schema:
`projectId`, `name`, `enabled`, `origin`, a Once or schedule trigger, and agent
execution with provider/model/reasoning/permission and project-default environment.

On the isolated 17-plugin `e81d75b` server at port 52686, replaying a fractional
Once timestamp returned HTTP 400 with `Invalid input: expected int, received number`
at `trigger.runAt`. The same request with whole milliseconds succeeded. A cron
schedule succeeded too. Both accepted scratch automations were disabled and
removed immediately. [Recorded responses](automation-baseline.json).

The rounding correction already landed in `3e705659`. It now lives in the shared
`Automation.onceTrigger(at:)` helper used by the editor. Native payload fixtures
exercise the full create request and response for Once and recurring schedules,
including a fractional Date input that must produce whole milliseconds. The
client also accepts an optional `enabled` argument (default remains true), so
fixture callers can create disabled automations directly.

The two fixtures in `apps/ios/Tests/Fixtures/automation-payloads.json` were accepted
by the stable built-in automations plugin. They are tested by
`AutomationPayloadTests`; this host plugin is not one of the repository's six
generated plugin contracts. The generated-plugin fixture check remains separate.

Validation: simulator build succeeded; `AutomationPayloadTests` passed its Once
and recurring fixtures, and `ThreadUITests/testChannelAutomations` passed the
live create/Once/pause/resume/rename/delete flow. Two tests, zero failures.
Result bundle: `/tmp/office-automation-payloads/results.xcresult`; log:
`/tmp/office-automation-payloads/tests.log`. `check:contracts`, the existing 32
generated-plugin payload fixtures, and `git diff --check` also pass.
