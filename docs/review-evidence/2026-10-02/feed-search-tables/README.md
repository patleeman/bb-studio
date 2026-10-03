# Feed, search freshness and Tables live verification

All checks used isolated stable BB at `127.0.0.1:49486` with data under
`/tmp/bb-studio-goal-staged`. Feed and Studio were installed from `3979fe1`;
Tables was installed from `38f64b5`. No production app or data was used.

## Feed

129 safe posts were published through the real Feed RPC. Only their own
created/read timestamps were set in the staged SQLite store to establish
repeatable local-date boundaries. The real reader and server queries selected
exactly 12 expected IDs using text, Research topic, unread, and October 1 dates
together. Midnight and the final millisecond were included; the adjacent days
were excluded. The older read urgent post still appeared under Needs you.

The browser reloaded with those filters intact. At 390 pixels every filter
control fit within the viewport, with no document horizontal overflow.
After loading 120 posts and opening the 66th, visiting the actual discussion
route and returning restored the open ID, 120-post window, scroll anchor,
-39.5-pixel anchor offset and 4769-pixel scroll position. Reload retained the
same values. Native key events exercised j/k navigation and m's persisted read
state change. No discussion was submitted to an agent.

`verify-feed-filters.mjs` is the reusable browser helper. Supply a caller-owned
fresh fixture's expected IDs and filter values. It validates the staged env,
asserts combined results and Needs you, reloads, captures desktop and 390-pixel
views, then restores the desktop viewport. `filter-reload.json` records its run;
`verification.json` records the broader reader and table checks.

## Studio search

This was a real server-side provider failure, not browser interception or a
fabricated freshness response. A temporary, backed-up change to only the staged
installed Pages bundle made studio_read throw for one fixture page. A real
studio_changed RPC triggered indexing. The previous body-only search hit
remained, while searchStatus reported stale with pendingProviders=[pages],
unavailableProviders=[], and discoveryIncomplete=false. The live Studio list
showed the cached hit, the incomplete-search warning, and Retry.

The exact original provider bundle was restored and Pages reloaded. searchRetry
recovered to current with no pending providers; the open Studio search removed
its warning and retained the result. Both screenshots and RPC results are saved.
Quick Open, confirmed-disabled provider removal, provider discovery failure and
search-status transport failure were not separately exercised.

## Tables

The real RPC created 1,200 rows and traversed 12 pages of 100, yielding 1,200
unique IDs. An edit between requests made continuation with the previous
revision fail with the restart-pagination error.

The native table loaded in roughly 1.7 seconds on this machine. DOM inspection
found 1,201 tr elements, 4,800 td elements, 2,400 grid cells and 18,696 total nodes.
All rows render at once. This is a qualitative observation, not a benchmark or
proof of bounded rendering cost. Remote latency and larger datasets were not
measured.

The fixture posts, table and search page were removed. The staged provider file
was byte-compared with its backup after restoration. The private browser was
closed. Feed's standard documentation capture was rerun separately with its own
seven-story fixture; its capture definition now clears restored filters before
asserting that fixture.
