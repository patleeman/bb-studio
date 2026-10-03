# Page title recovery

The real staged browser now preserves failed title updates across reload,
offers explicit conflict choices, and reconciles a lost response without a
second write. The final [verification](after/verification.json) pins source
`af91530` and its installed artifact. Root inspected the phone screenshots.

Two live reproductions preceded the final fix:

- [Before title recovery](before/verification.json), a blocked update request
  left the typed title on screen but lost it after reload. No title error was
  shown. The body save indicator did not acknowledge that metadata operation.
- [Before predecessor cleanup](quota-before/verification.json), an earlier
  local draft survived after a newer title recovered from quota failure and
  saved to BB. The intentionally failing assertion records the stale record;
  this diagnostic run is not a passing checkpoint.

The final loop verifies:

1. A failed title request leaves the server unchanged, exposes an error and
   restores the local draft after a new document loads. Retry then saves it.
2. Another writer changes the server title. Retry preserves both values;
   **Use my title** explicitly saves the local choice. A stale atomic title
   comparison is rejected. Download retains the draft, and Discard restores
   the saved title without another update.
3. Local storage fails after an earlier durable draft. The newest title and
   exit warning survive navigation. Once storage and transport recover, the
   newer title saves and its explicitly superseded records are removed.
4. The server commits a title, then the browser's response is aborted. Reading
   back the server reconciles that outcome: exactly one update request.
5. A deleted page has a title draft but no pending body recovery. Its title
   remains reachable after reload and a failed local read. The exported JSON
   contains it; no Pages socket opens and no server page is recreated.
6. An injected cyclic recovery record produces a read error. Download keeps
   both the corrupt raw record and the valid draft. Removing only the injected
   fixture record and retrying exposes the retained title again.

The normal conflict actions are 44px high, inside the 390px viewport and
hit-testable. See [conflict](after/title-conflict-phone.png),
[local storage failure](after/title-local-failure-phone.png),
[deleted title](after/deleted-title-reloaded-phone.png) and
[corrupt recovery](after/corrupt-title-recovery-phone.png).

Source checkpoints: `08fb72d` adds durable title drafts and atomic comparisons;
`03513de` keeps memory recovery across plugin reloads; `8468383` exposes titles
when metadata is missing; `a9b93b7` removes only linked predecessor records;
`af91530` reports cyclic recovery as a read failure. Focused tests also cover
independent views, newer typing, captured page/origin, repeated quota-failed
keystrokes, failed cleanup and module reloads.

The generated Pages contract compiled with the native app, Share, Widgets,
Notifications, Watch and WatchWidgets in a private build-only check
([record](native-build.json)). No native app or simulator was launched for it.

To repeat the complete live loop after installing the pinned Pages source:

```sh
source /tmp/bb-studio-goal-staged/capture.env
BB_CAPTURE_CDP_PORT=49569 \
BB_PAGES_TITLE_SOURCE=af91530fc66645a3d59f6e961eac57b22c1a4d53 \
BB_PAGES_TITLE_EXPECT_RECOVERY=1 BB_PAGES_TITLE_DELETED=1 \
node scripts/capture/verify-page-title-recovery.mjs
```

The [helper](../../../../scripts/capture/verify-page-title-recovery.mjs) creates
and removes only its disposable page and browser. Faults affect that browser,
not the machine network. The predecessor and cyclic-record faults are injected;
the browser uses real localStorage and the real Pages server. The before runs
remain as diagnostic evidence. Downloads contain deterministic fixture data.

When browser storage is unavailable, memory-only recovery cannot survive
browser exit or reload; the UI warns and offers download. Recovery JSON does
not automatically recreate deleted pages or import metadata. Viewport emulation
does not establish physical iOS or VoiceOver behavior. Body/Yjs recovery has
[separate live evidence](../pages-durability/README.md).
