# Six-plugin consolidation verification

Stages 1 and 2 of [the office model](../../../office-model.md). The staged app
started from the 17-plugin layout at `e81d75b`, then imported each module as its
folded version was pushed. The final install contains exactly Studio, Pages,
Draw, Float, Reactions and Mobile; all six are enabled.

[Machine-readable evidence](verification.json) records the original item IDs,
11 import receipts, source retention, recording byte hash, installed Git
commits, and the public tool-schema comparison.

- Tables retained their rows and Unicode content; Chat retained its home-thread KV.
- Pages retained block IDs, formatting and comments while owned item links were
  rewritten. Feed and Tasks retained their seeded items and links.
- Teams retained the bot home and channel identity through the office
  conversation migration.
- Artifacts retained metadata, version data and exact downloaded bytes.
- Recordings retained their ID and exact 32,044-byte audio fixture.
- Decisions retained the disabled queue, fallback choice and synthetic secret.
  The secret migrated directly to the protected store, not SQLite.
- Sidebar preferences matched exactly after migration.
- Explore rows matched exactly, its non-default settings migrated, and
  `bb pages explore list` worked. Its live companion check loaded a saved Page
  in-process, retained its iframe and scroll state, and avoided duplicate panels.
- Import receipts remained unchanged after reload. Removing legacy plugin
  registrations retained their original database files.

The 43 original tools were registered from baseline build artifacts under the
SDK test host and compared with the consolidated Studio and Pages registrations.
Names match exactly. Forty input schemas match exactly; the three differences
are the explicit exceptions approved in spec commit `8d8d1d2`.

The native worker verified `682547f` plus the TableView and SpaceViews route fixes:
simulator build passed; 96 tests, one skipped, zero failures. Full repository
checks include stable compatibility, marketplace parity, generated contracts,
32 native payload fixtures and the packed kit.

Live captures:
[Sidebar](../../../../packages/bb-studio/src/modules/sidebar/assets/staged-preview.png),
[Navigation](../../../../packages/bb-studio/src/modules/navigation/assets/staged-preview.png),
[Explore in Pages](../../../../packages/bb-studio-pages/src/explore/assets/companion-preview.png).

The compatibility exceptions remain intentional: old external bookmarks and
past BB transcript links cannot be served under removed plugin IDs on the stable
SDK. Owned references are migrated; Studio still parses legacy item prefixes.
CLI commands use `bb studio <old-id> …`, with Explore under `bb pages explore …`.
