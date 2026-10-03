# Durable recovery live verification

Isolated stable BB on 49486, Draw/Talk from pushed checkpoint `30c2869`.
The browser used its own temporary profile. No production UI or data was used.

## Draw

All local scenes originated in actual canvas pointer edits. They were not
inserted into IndexedDB as fixtures.

- While Chrome networking was offline, drawing a rectangle committed a draft.
  Networking was restored to load the app, while saveDrawing remained blocked.
  Reload retained the exact draft record, token and scene and showed recovery.
- A real second-writer RPC changed the source drawing. Recover draft refused the
  stale revision and retained its local draft; the server still had the second
  writer's element. Save as copy retained the original local element separately.
- For the first copy request, a browser fetch wrapper awaited the real response
  body, then threw to simulate a lost response after commit. The retry produced
  the same single complete copy, not a duplicate.
- A quota exception from actual IndexedDB puts showed the storage warning.
  Restoring the API and clicking Retry local storage committed the scene.
- Two already-open editors made distinct real canvas edits. Their committed
  drafts had separate IDs, tokens and element IDs. A fresh tab displayed both
  recovery choices.

The initial CDP harness did not enable Page events before dirty reload. Both
Runtime.evaluate and screenshots then stalled on the old target. This was
resolved by enabling Page events and accepting the actual beforeunload dialog.
The final offline test and the reusable helper both passed real reload, with
beforeunload recorded. No Draw renderer freeze is established by those earlier
harness timeouts. Clean saved-drawing reload also worked.

`verify-durable-recovery.mjs` contains the guarded offline browser test,
beforeunload handling, real IndexedDB inspection and scoped quota injection.
It deliberately keeps the returned fixture until its caller cleans up the
isolated browser profile and drawing. The helper was executed successfully.

## Talk

Chrome's synthetic microphone ran through the real browser MediaRecorder.
No recording metadata or audio chunks were seeded. segment_put was blocked to
keep committed chunks local for inspection.

The first committed chunk was 14,467 bytes. A later IndexedDB quota exception
stopped capture. The saved marker had localSaveFailed=true and insert=false.
Download audio generated a nonempty 31,210-byte WebM/Opus blob. Retry saved all
three chunks (14,467 + 16,498 + 245 bytes), and their committed records survived
reload unchanged. A subsequent failed capture reloaded with the explicit
memory-only-audio loss warning. The server remained paused; acknowledgement
cleared the warning but kept insert=false. No automatic finalization was seen.

### Defect reproduced on 30c2869; fix verified on 35bb73f

After explicit acknowledgement, deny localStorage.setItem only for
`bb-plugin-talk:active`, resume real capture, and make the next Talk IndexedDB
put fail. The immediate error appears, but persist() silently swallows the
marker failure. localStorage retains localSaveFailed=false. Reload shows Paused
without the lost-tail warning or acknowledgement requirement. See
`talk-verification.json` deniedMarker/deniedReload and the corresponding PNG.
This defect was reported to the source owner before any source changes.
The same scenario was rerun after installing `35bb73f`. Denied initial marker
writing visibly refused capture: zero MediaRecorder instances and no active
marker. After storage was restored, real capture committed a 14,467-byte chunk
and captureInProgress=true. Denying both subsequent marker writes and IndexedDB
puts retained that existing flag. Reload showed “Capture was interrupted. The
last unsaved audio may be missing”; the server stayed paused. Explicit
acknowledgement set captureInProgress=false and insert=false. This closes the
reproduced marker-failure defect. The fixed JSON and screenshots are labeled
35bb73f.

Download uploaded audio's server export route was not counted as passing; its
separate paused-recording limitation was already being fixed by the source
owner. Browser reload is tested; hard power loss, OS eviction, Safari and
simultaneous corruption of every durable store are not. In-memory download
blob creation is verified, not playback of a file written by the OS.

All source drawings, recovery copies and recordings were deleted after capture.
The isolated browser and its profile were removed, including its local drafts
and outbox. No temporary source patch was used for this verification.
