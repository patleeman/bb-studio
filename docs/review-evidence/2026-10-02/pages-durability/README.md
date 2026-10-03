# Browser Pages durability

The real staged stable BB passes body recovery after a new document load,
two-tab IndexedDB merges, visible server-write failures, explicit retry and
recovery export. Source `5c6d5e8` implements recovery; `54b829b` enlarges the
recovery actions to 44px and adds visible keyboard focus.

The [verification record](verification.json) pins the installed Git commit and
built artifact. The [capture helper](../../../../scripts/capture/verify-pages-durability.mjs)
uses the normal BB shell and editor, native input events and real storage.

- An offline edit is absent from server SQLite and present in IndexedDB. Two
  separate tabs then edit the same recovered document. Both changes survive
  the atomic recovery merge and appear after reload with a new `timeOrigin`.
  Reconnection saves the complete content and removes the acknowledged backup.
- A SQLite trigger rejects writes to only the disposable page. The editor
  shows **BB save failed · Saved on this browser**. Its download decodes as
  valid Yjs and contains the newest edit. Removing the fault and pressing
  Retry confirms the actual server disk content.
- An injected local write exception exposes **Local recovery failed** and
  retains the in-memory edit. The exit warning remains active after navigating
  away. Returning, restoring storage and pressing Retry commits the backup and
  clears the warning; reconnecting then saves to BB.
- At 390px, both recovery actions are at least 44px high, fully inside the
  viewport and hit-testable. Root also inspected the actual screenshots.

See [server failure on phone](server-write-failure-phone.png),
[local recovery failure](local-recovery-failure-phone.png), and
[recovered content](all-recovered-phone.png). The helper removes its page and
SQLite trigger, closes its owned browser and deletes its private profile.

Run against the root-owned isolated fixture, after installing the exact
pushed Pages source:

```sh
source /tmp/bb-studio-goal-staged/capture.env
BB_CAPTURE_CDP_PORT=49569 \
BB_PAGES_DURABILITY_SOURCE=54b829b46594c80a27a7515f13183ac7dd39089b \
node scripts/capture/verify-pages-durability.mjs
```

The socket fault affects only this browser's Pages connections; BB metadata
and the shell remain available. This does not establish a fully offline app
launch. The database failure is an actual rejected SQLite write, not a full
physical disk. The quota error is injected, while the recovery and two-tab
phases use unmodified IndexedDB. The phone viewport is emulated.

The `.yjs` download preserves collaborative structure; it is not a Markdown
document or a normal UI import workflow. Page title updates have a separate
recovery gap. Deleted-page wrappers also still need to expose retained local
recovery. Both are tracked in the [issue ledger](../../../review-issues.md);
passing this body-storage check does not close them.
