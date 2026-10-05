# Studio settings audit

Reviewed the suite on 2 October 2026; updated for the 11 published plugins
on 4 October 2026. The shared kit
is a library, not an installed plugin. This sweep checked model selection,
automatic work, data retention, notifications, and persistent view preferences.

## Changes

- **Talk:** separate provider/model pickers for cleanup, titles, and summaries,
  with reasoning and supported service tier. Each defaults to Studio Decisions.
  Choices persist on the server and apply to the next request. Segment length
  and audio retention now validate their supported ranges. The docs no longer
  list removed title-provider fields.
- **Decisions:** accepts a caller's explicit model without changing the global
  fallback. Its fallback picker also retains the service-tier choice.
- **Explore (inside Pages):** maximum duration for each new explainer, default
  20 minutes. Feed findings and the daily digest have been removed.
- **Pages:** saved-version retention, previously fixed at 50. It accepts
  1 to 1000 versions or 0 to keep all. Lowering the limit prunes history on the
  next snapshot of that page. Equal-time snapshots retain the newest insertion.

## Coverage

Settings can live beside the item they affect, in a plugin's settings page,
or in BB's shared settings. The table identifies the current owner so users
do not have to maintain competing defaults.

| Plugin | Important controls and location | Outcome |
| --- | --- | --- |
| Studio | Saved views, query filters, spaces, tags, Command layout and approval mode, and sidebar item visibility/order; theme in BB Appearance | Existing controls cover the hub. Saved content and version history remain until explicitly removed. |
| Studio item chat | BB's new-conversation composer selects project, environment, provider/model, reasoning, and permissions; existing chats use native thread controls | Existing controls cover execution choices. |
| Float | Resize/dock/reorder on each panel; show/hide command; shortcuts in BB Keyboard | Existing controls cover layout and access. |
| Pages | Page location, icon, chat, history and restore | Added global version-retention setting. |
| Explore | Suggestions switch and explainer time limit in Pages settings | The digest is retired. The explainer inherits its source thread's model. |
| Talk | Microphone replacement, segment length, automatic titles/summaries, hold key, audio retention; cleanup toggle per device in the recorder; playback controls on recordings | Added the 3 model pickers and numeric validation. Transcription still uses BB AI services. |
| Draw | Excalidraw's canvas controls and item-level title, project, export, and deletion | Existing controls cover drawing preferences. There is no background model job to configure. |
| Artifacts | Explicit save/upload, project placement, item versions, preview/download/export, archive/delete | Existing item controls cover storage actions; no automatic expiry is imposed. |
| Sidebar | Navigation visibility/order in BB Appearance; thread organization, sorting/direction, grouping, hidden/collapsed groups, row actions, provider icons, and background-thread visibility | Existing sidebar preferences cover layout. |
| Mobile | APNs credentials/environment/bundle and Expo endpoint in plugin settings; mute per thread; notification permission and presentation in BB/iOS | Relay configuration already exists. BB's Push notifications plugin owns event selection. |
| Reactions | Reaction list, quoting/quote placement, selection/message-bar visibility, smart-reaction switch | Existing plugin settings cover its behavior. |
| Decisions | Jev providers/keys/models/timeout, Smart Queue confidence thresholds, connection check, fallback provider/model/reasoning/off | Added service-tier persistence and the explicit-model RPC used by Talk. |
| Tables | Column types/options/order/width, saved views with filters/sorts/grouping and visible columns | Existing table/view controls cover preferences; no global automation setting is needed. |

## Boundaries

Internal payload limits, polling intervals, retries, and rendering thresholds
remain implementation details. Turning every constant into a setting would
make configuration harder without giving users a meaningful choice. Unlimited
artifact and hub history retention remains the current policy; this sweep does
not introduce automatic deletion of saved work.

New Talk model choices and existing defaults use the same temporary-thread
lifecycle in Decisions. If cleanup fails, Talk keeps the original transcript.
Model changes do not rewrite saved cleanups, titles, or summaries.

## Verification

Focused tests cover model-choice persistence, per-job routing, temporary-thread
cleanup, worker deadlines, and version retention. The Talk
settings capture uses stable BB, installs from the pushed Git revision, chooses
a model source through the UI, and verifies persistence after navigation.
Repository checks cover types, tests, stable SDK compatibility, docs, marketplace
indexes, generated contracts, and the packed shared kit.
