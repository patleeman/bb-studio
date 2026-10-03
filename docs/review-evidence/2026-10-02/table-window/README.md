# Large table grid verification

Stable BB 0.45.0, isolated `/tmp/bb-studio-goal-staged`, Tables installed from
pushed `cc3065e`. The reusable `scripts/capture/verify-table-window.mjs` creates
and deletes its own tables and uses a separate headless Chrome profile.

| Rows in table | Initially mounted data rows | Initial document elements | Phone mounted rows |
| --- | ---: | ---: | ---: |
| 1,200 | 39 | 1,293 | 31 |
| 5,000 | 39 | 1,310 | 31 |

The previous 1,200-row check mounted every row and counted 18,696 document
elements. The new grid renders a visible window, retaining an active editor
or selected row outside that window. Full row counts and row indices remain
available to accessibility tools.

Actual keyboard input jumped to the final row at both sizes. Its cell was
visible below the sticky heading. Typing opened its editor, scrolling back
to the top preserved the exact focused input DOM and draft, and Enter saved
that value through the real plugin RPC. Both 390-pixel captures have no
document horizontal overflow; columns scroll inside the grid. Unit regressions
also copy all 1,200 rows while only a window is mounted.

The JSON includes navigation time and Chrome performance counters. Navigation
time includes the driver's fixed 900ms wait and is **not a speed benchmark**.
Heap and node counters are snapshots without forced garbage collection and
include prior activity; they do not establish a memory-growth bound. The full
table still loads and sorts locally. Remote latency, repeated-session memory,
board/calendar rendering, CSV/import and artifact format limits remain separate
checks. No production data or browser profile was used.
