# Studio approval audit

Skill saves apply immediately. Bot info → Skills has append-only content history,
line diffs, advisory warnings, and one-click Revert. Revert appends a version.
The upgrade applies pending writes and deletes as approved, retaining prior content.
For one release the deprecated resolver returns the learning view with `pending: []`
and `approval: false`; the old approval input is ignored. No external action is added.

Each entry names the decision point and its reason (paths relative to the repository):

- Removed — `packages/bb-studio/server.ts:1228`: skill writes and review-fork patches apply immediately; history makes mistakes reversible.
- Removed — `packages/bb-studio/src/ui/bot/BotHome.tsx:501`: pending approval UI and mode are replaced by history, diffs and Revert; warnings do not block.
- Removed — `packages/bb-studio/src/pages/ui/dialogs.tsx:88`: page Restore needs no second confirmation because the current version is saved first.
- Removed — `packages/bb-studio/src/dashboards/ui/dashboard-view.tsx:435`: dashboard Restore needs no second confirmation because the current version stays in history; script approval remains separate.
- Already immediate — `packages/bb-studio/server.ts:602`: Bot Memory edits use the ordinary page tools, with no approval queue.
- Already immediate — `packages/bb-studio/src/pages/server.ts:257`: agent page edits apply immediately; expected-content checks prevent overwriting concurrent edits.
- Already immediate — `packages/bb-studio/server.ts:1371`: Bot automation creation requires no approval; scheduling and input checks remain.
- Removed — `packages/bb-studio/src/ui/bot/Runners.tsx:83`: runner adoption applies from its explicit action button; candidate/ownership checks remain and releasing adoption reverses it.
- Already immediate — `packages/bb-studio/src/bot-profile-tools.ts:55`: self-profile updates apply immediately with history; field and identity restrictions remain.
- Already immediate — `packages/bb-studio/src/bot.ts:1043`: skill sharing needs no approval; the name collision check protects existing shared skills.
- Already immediate — `packages/bb-studio/src/dashboards/server.ts:374`: widget definitions save immediately; their HTML runs in a sandbox without network or shell access.
- Removed — `packages/bb-studio/src/ui/health/HealthViews.tsx:74`: Turn off plugin applies directly; disabling is reversible and does not delete settings.
- Removed — `packages/bb-studio/src/ui/bot/Automations.tsx:62`: turning off an original check-in pauses it immediately; its schedule is retained. Delete still confirms.
- Kept — `packages/bb-studio/src/dashboards/server.ts:191`: exact-command script approval protects host shell execution; nonces, hashes and revoke remain.
- Kept — `packages/bb-studio/src/auto-resume.ts:70` and `packages/bb-studio/src/thread-resume.ts:98`: retry caps stop repeated paid agent work; `packages/bb-studio/src/design/server/review-queue.ts:13` caps repeated model reviews.
- Kept — `packages/bb-studio/src/openai-key.ts:15`: secret settings and missing-key checks protect credentials and paid services.
- Kept — `packages/bb-studio/server.ts:1191`: pause/stop worker restrictions and user-controlled resume prevent the Bot from disabling or restarting itself through workers.
- Kept — `packages/bb-studio/src/pages/ui/shared.tsx:103`, `packages/bb-studio/src/draw/ui/drawing-editor.tsx:509`, `packages/bb-studio/src/talk/ui/recordings-panel.tsx:489`, `packages/bb-studio/src/ui/bot/Runners.tsx:126`, `packages/bb-studio/src/ui/bot/Automations.tsx:72`, and `packages/bb-studio/src/ui/bot/BotHome.tsx:472`, and `packages/bb-studio/src/artifacts/ui/artifact-viewer.tsx:188`: delete confirms protect content or schedules.
- Kept — `packages/bb-studio/src/draw/ui/drawing-editor.tsx:563` and `packages/bb-studio/src/ui/setup/BackupSection.tsx:85`: draft discard and backup restore can destroy unsaved work or replace application data.
- Kept — `packages/bb-studio/src/ui/setup/SetupPage.tsx:103`: uninstall confirmation protects plugin settings that removal deletes.
- Kept — `packages/bb-studio/src/ui/bot/BotHome.tsx:205`: stopping a Bot interrupts running work; its existing confirmation is outside the Skills section.
- Kept — `packages/bb-studio/src/ui/bot/BotCache.tsx:75`: compaction replaces detailed conversation context; this task also excludes cache UI changes.
- Kept — `packages/bb-studio/skills/studio/SKILL.md:88`: outward-facing actions, spending and destructive deletes require the user's instruction; voice-call code is unchanged.

“Pending” in save acknowledgements, thread scheduling, design questions, and
connection state is operational state, not an approval gate. Setup installation
and recovery dialogs protect installed code or application data. Side-thread
write restrictions protect ownership; they do not queue ordinary Bot saves.

## iOS follow-up

Leave the hand-written iOS UI for the lead: `apps/ios/iOS/Bot/BotSheets.swift:212`
contains the Skills sheet, pending section at line 235, and approve/reject controls;
`apps/ios/Shared/Bot.swift:150` contains the resolver wrapper, with approval/pending
models at lines 532 and 534. Old clients receive an empty pending list. Generated
contracts include the new history and revert RPCs. Add the history UI to iOS and
remove its old approval toggle and pending section before retiring the resolver.

No live BB, staged BB, external service, or paid model was used for this change.
