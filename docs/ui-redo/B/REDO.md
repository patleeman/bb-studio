# UI redo B: iOS app (not the unfolded Duo layout)

Branch `bb/ui-redo-b-claude-thr_yrqxctt3qt`. All renders are dark mode from
owned simulators: iPhone 18 Pro and iPad Pro 13-inch (M5), iOS 27.0. The Duo
renders are the 951×669 Duo window on the iPad simulator (`-qaDuoColdWide`).
"Before" is the branch base plus the debug harness; "after" is this branch.
Each before and after pair comes from the same capture test and fixtures.

## How the renders were made

`apps/ios/UITests/ErrorStatesCaptureUITests.swift` drives each state in the
real app and writes PNGs. The data is local (`-qaBotDemo`, plus the new
`-qaStateDemo dictation|related` and `-qaOutboxUnreadable`), and the server
is a closed local port, so every error is a real "Can't reach BB" from
`BBClient`. Nothing reaches a real server.

```sh
TEST_RUNNER_BBGO_STATES_OUT=/tmp/shots TEST_RUNNER_BBGO_STATES_TAG=after- \
  xcodebuild test -scheme BBStudio -destination id=<sim> CODE_SIGNING_ALLOWED=NO \
  -only-testing:BBStudioUITests/ErrorStatesCaptureUITests
```

`TEST_RUNNER_BBGO_STATES_MOTION=reduced` captures the Reduce Motion look, and
`TEST_RUNNER_BBGO_STATES_HOLD=<s>` keeps the Bot rows on screen for
`simctl io recordVideo`.

## Bot sidebar row states (shared spec, done first)

Follows `bot-row-states-spec.md` and C's field names (`running`,
`runningSince` on runners; `runningSince` on `bot_activity` threads). Both
fields are optional, so an older Studio shows no runner as running and no
clock. Commit `cfbf4601`.

| State | iOS row |
|---|---|
| Running (thread or runner mid-run) | 2 pt green quarter arc on a faint track, one turn per 1.6 s; right side ticks `0:42`, `12:05`, `1:02:10` from `runningSince` (the age when BB can't tell) |
| Reduce Motion | still full green ring plus a 6 pt live dot at the bottom right; the clock still ticks |
| Waiting for you (needs you, queued, urgent runner) | still amber ring; the age |
| Failed (thread, or a runner's last run) | still red ring; a thread says `failed` in red; a runner says `next Sat 9:57 PM · failed` with `failed` in red |
| Runner between runs | mark at 45% opacity and greyscale, hairline ring; `next 11:00 PM · quiet` or `· reported`, the outcome muted (desktop's `runnerLastRun` rules) |
| Paused runner or automation | dimmed like idle; `paused` |
| Recurring (Schedule) | dimmed mark with the repeat glyph; `next Mon 8:57 PM` or `paused` |

Sizes match desktop: a 16 pt box, an 11 pt logo, a 1.5 pt ring at r=7.25 and
a 2 pt arc at r=7. Only running marks move. The right-hand text no longer
truncates; the name does. VoiceOver says "Running for 12 minutes", "Next run
11:00 PM, last run quiet", "Paused" or "Failed". The rules live in
`Shared/BotThreads.swift` (`BotRowState`, `BotRowTime`, `BotRunner.rowState`)
and are covered by `BotRowStateTests`.

| Surface | Before | After | Reduce Motion |
|---|---|---|---|
| Phone, Running | ![](bot-rows/before-bot-rows-phone.png) | ![](bot-rows/after-bot-rows-phone.png) | ![](bot-rows/after-bot-rows-phone-reduced-motion.png) |
| Phone, every runner state | ![](bot-rows/before-bot-rows-phone-runners.png) | ![](bot-rows/after-bot-rows-phone-runners.png) | ![](bot-rows/after-bot-rows-phone-runners-reduced-motion.png) |
| Duo 951×669, top | ![](bot-rows/before-bot-rows-duo.png) | ![](bot-rows/after-bot-rows-duo.png) | ![](bot-rows/after-bot-rows-duo-reduced-motion.png) |
| Duo 951×669, Runners | ![](bot-rows/before-bot-rows-duo-runners.png) | ![](bot-rows/after-bot-rows-duo-runners.png) | ![](bot-rows/after-bot-rows-duo-runners-reduced-motion.png) |

The running animation: [phone (MP4)](bot-rows/phone-running.mp4) ·
[Duo (MP4)](bot-rows/duo-running.mp4)

![Phone running animation](bot-rows/phone-running.gif) ![Duo running animation](bot-rows/duo-running.gif)

## Redone changes

| Change | Codex SHA | What I changed | Before | After |
|---|---|---|---|---|
| Outbox save error and Retry saving (ThreadView) | 21f27c3a (redo `0f527b39`) | The error was a translucent full-width red box over the transcript, with centred orange "Retry saving". On iPad it sat on top of the Bot's header text, so neither could be read. It is now a shelf card above the composer, like "The last turn failed": a red icon, the message (up to 3 lines) and a Retry button. The message no longer ends in "format.." (doubled period). It shows once, even when the failed send also set the thread error. | ![](thread/before-phone-outbox-save-error.png) ![](thread/before-ipad-outbox-save-error.png) | ![](thread/after-phone-outbox-save-error.png) ![](thread/after-ipad-outbox-save-error.png) |
| Stop failure on the phone | 1d94e533 (redo `0f527b39`) | Thread errors (a failed Stop among them) were a low-contrast red capsule floating over messages, dismissed only by an undiscoverable tap. Now a glass toast with a red warning icon, primary text, and a 28 pt dismiss button; tapping still dismisses it. On iPad it is capped at 560 pt and centred. While Stop's request is out, the button shows a spinner instead of looking unchanged. | ![](thread/before-phone-stop-failed.png) ![](thread/before-ipad-stop-failed.png) | ![](thread/after-phone-stop-failed.png) ![](thread/after-ipad-stop-failed.png) |
| Stop failure on the Watch | 1d94e533 (redo `c43d0e25`) | The error went into `status`, which shows in grey at the very bottom of the list, below the reply field and quick replies, far from the Stop button. It now shows in red under "Working…" while the thread still runs (it falls back to `status` once the thread has ended). The row says "Stopping…" while the request is out, and the Stop button has a 32 pt target and a label. No Watch render: there is no Watch UI test target, and the view needs the phone relay. | n/a | n/a |
| Dictation send error (Talk) | f11bc45c (redo `35181866`) | The error was a centred red line squeezed between the buttons, and Send changed its label to "Sending…". Send now spins like "Save as Page" next to it, and the error (Save as Page's too) is a leading red line with an icon. The text stays in the editor, so it can be tried again. | ![](dictation/before-phone-dictation-send-failed.png) ![](dictation/before-ipad-dictation-send-failed.png) | ![](dictation/after-phone-dictation-send-failed.png) ![](dictation/after-ipad-dictation-send-failed.png) |
| Comment reply drafts kept until sent (Studio Related) | 1e5c605e (redo `0665260d`) | **Behaviour bug, not only visuals.** Cancel and Send were plain buttons in one List row, and in a List a tap on that row runs both. So tapping Send also ran Cancel, which wiped the draft this change was meant to keep. The before render shows it: after the failed send the field and the text are gone. Also, the field sat at the bottom of the section, cut off from the comment, and its buttons were under the keyboard. Now: every action is borderless, so each does only its own job. "Reply" turns into "Cancel" on that comment. The field sits at the end of the comment's thread, with the arrow send button the Pages comments use (a spinner while sending). A failed reply's error sits above the field and scrolls into view over the keyboard. Comments also show author and age like Pages comments, and replies are indented under their comment. | ![](related/before-phone-related-reply-draft.png) ![](related/before-phone-related-reply-failed.png) | ![](related/after-phone-related-reply-draft.png) ![](related/after-phone-related-reply-failed.png) |
| Same, iPad | 1e5c605e | As above. | ![](related/before-ipad-related-reply-failed.png) | ![](related/after-ipad-related-reply-failed.png) |
| Bot screen leftovers removed | ee716414 | Checked, no change needed. Removing "Waiting for your approval" leaves the Skills sheet with the learning toggle and its footer, the skills, and Archived, all evenly spaced. | ![](bot-skills/before-phone-bot-skills.png) | ![](bot-skills/after-phone-bot-skills.png) ![](bot-skills/after-ipad-bot-skills.png) |

Unit tests for the behaviour of each change (`OutboxPersistenceTests`,
`ThreadStopTests`, `DictationSubmissionTests`, `RelatedReplyTests`,
`BotTests`) are unchanged and pass.

## Review only

| SHA | What it does | Visual notes |
|---|---|---|
| 8c64c3c7 | Keeps "unavailable" reads and RPC decoding errors instead of turning them into empty results (BBClient, Dashboards, Pages, StudioChat) | No view code. One visible effect: Studio item chat (`startStudioChat`) now fails with an error when the project's defaults can't be read, where it used to start with default settings. Worth a look if item chats start failing on flaky connections. |
| 01513dc8 | Percent-encodes search and timeline query values | No UI. |
| f7bfd8a0 | Pages ignores a page-tree load that a newer load superseded | No visual change. The loading state ends only when the newest load finishes, which is right. |

## Not changed and worth noting

- iOS has no provider artwork, so the 11 pt logo slot in Bot rows uses a
  neutral `sparkle` glyph (and `repeat` for Recurring) where desktop shows the
  provider's logo. Matching desktop exactly means shipping provider logos to
  the app, and decoding `providerId`, which `bot_activity` and `bot_runners`
  already send.
- `PlanReviewSheet` still uses the old red capsule for its error. It could use
  the new `ErrorToast`.
