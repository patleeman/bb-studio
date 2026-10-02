# Saved views verification

Run `pnpm check` and build the BBStudio iOS simulator scheme. Teams tests cover reference membership, descendants, final-only source projection, equal-timestamp pagination, direct thread replies, explicit recipients, uncertain addressing, fresh threads, shared rosters, partial delivery retries, migration resume, automation retargeting, bot creation approvals, mission fallback and cancellation recovery.

Use `node scripts/staged-bb.mjs start --ref COMMIT` with a dedicated `BB_STAGED_DIR` and `BB_STAGED_PORT`. The staged stable app installs the pushed plugins and seeds the Launch work view with real replies from Atlas and Scribe. Source its capture.env, then run `node scripts/capture-plugin-screenshots.mjs --plugin bot-teams`.

The capture asserts the running app's saved view, owner input, both final replies, member thread links and recipient controls. Inspect the PNG at desktop and compact widths. Open a member thread and verify its ordinary composer and profile. Stop the staged instance after capture. Keep the working BB's private data out of screenshots.
