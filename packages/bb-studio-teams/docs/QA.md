# Saved views verification

Run `pnpm check` and build the BBStudio iOS simulator scheme. Teams tests cover reference membership, descendants, final-only source projection, equal-timestamp pagination, direct thread replies, explicit recipients, uncertain addressing, fresh threads, shared rosters, partial delivery retries, migration resume, automation retargeting, bot creation approvals, mission fallback and cancellation recovery.

Use `node scripts/staged-bb.mjs start --ref COMMIT` with a dedicated `BB_STAGED_DIR` and `BB_STAGED_PORT`. The staged stable app installs the pushed plugins and seeds the Launch work view with real replies from Atlas and Scribe. Source its capture.env, then run `node scripts/capture-plugin-screenshots.mjs --plugin bot-teams`.

The capture asserts the running app's saved view, owner input, both final replies, member thread links and recipient controls. Inspect the PNG at desktop and compact widths. Open a member thread and verify its ordinary composer and profile. Stop the staged instance after capture. Keep the working BB's private data out of screenshots.

Verified on 2026-10-02 against stable BB 0.44.0 installed from Git, with Teams at `2467f36`. All four captures passed, including compact overflow, control clearance and latest-reply visibility assertions. An unresolved mention preserved the draft; opening an originating thread showed its ordinary composer and Atlas profile. Full repository checks passed, along with the iOS simulator build and both SavedViewTests.
