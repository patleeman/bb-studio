# Stage 9 Office QA

## Staged environment

Stable BB 0.45.0, six-plugin Git install at `10acf56`, isolated server on 52186.
The capture seed creates three bots (Atlas, Scribe, Quinn), a channel, an Atlas
DM, a reviewed task, a report, and an inert plugin approval. No bot turn or
approval is dispatched. `fixtures.json` records the staged IDs.

## Web captures

All assertions passed against the real rendered BB application.

- [Home](../../../../packages/bb-studio/assets/staged-preview.png)
- [Inbox, All spaces](../../../../packages/bb-studio/assets/office-inbox.png)
- [Team faces and folders](../../../../packages/bb-studio/assets/office-sidebar.png)
- [Bot desk: Chat](../../../../packages/bb-studio/assets/office-bot-chat.png)
- [Bot desk: Tasks](../../../../packages/bb-studio/assets/office-bot-tasks.png)
- [Space settings](../../../../packages/bb-studio/assets/office-settings.png)
- [Delegate dialog](../../../../packages/bb-studio/assets/office-delegate.png)
- [Ask first approval](../../../../packages/bb-studio/assets/office-approval.png)

Pages, Draw, Float, Reactions, and Mobile also have refreshed primary staged
previews. Float checks that its page editor survives the move from the page
header and opening Office Home.

## Native captures

Private simulator `CF1B0476-6432-46CB-8EB3-255297208A71`, iOS 27.0. Build succeeded.

- [Inbox](office-inbox-ios.png)
- [Home](office-home-ios.png)
- [Work](office-work-ios.png)
- [Team](office-team-ios.png)

Inbox, Home, and Work capture tests passed. Team rendered correctly, but tapping
the Atlas NavigationLink did not open the bot desk. The failure reproduced with
the actual accessible button after an initial static-text selector attempt.
Reported to the coordinator; native bot-desk captures and the full UI-test result
remain pending. Raw result: `/tmp/stage9-ios-office/results.xcresult`.

## Legacy cleanup

[Live cleanup results](cleanup-live.json): seven legacy directories archived and
removed on the original 17-plugin migration fixture. Every archived file hash
was verified. All seven current collection items remained unchanged. Teams was
retained because its bot homes still use that directory. A repeated dry run
reports only the retained directory. No production data directory was touched.

The RPC, generated contracts, and six focused tests are committed in `1eb716f`
and `4d23945`. Full `pnpm check` passed before the final log-archive addition;
its focused test suite passed afterward. Final suite/install verification is pending.
