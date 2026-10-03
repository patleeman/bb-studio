# Large tables and view lifetime

The staged baseline confirms excessive rendering in 5,000-row board and calendar views. Board mounts 5,000 cards and 30,722 live DOM elements; calendar mounts 5,000 cards and 5,903 elements. The repeated SPA readiness medians are 3,281ms for board and 1,159ms for calendar.

The fix pages dense board lanes in groups of 50 and calendar days in groups of 10. Each bucket retains its total count and offers labeled first, previous, next and last controls. Small views keep their current layout. Page indices clamp when filtering or deletion reduces a bucket. Calendar grouping now appends to each day's array instead of copying that array for every row.

The first packaged-fix run exposed a separate calendar layout defect: the month grid shrank as a flex child, so day content overlapped later weeks and intercepted the native paging click. The [desktop reproduction](calendar-overlap/desktop.png) and [390px reproduction](calendar-overlap/mobile.png) preserve that failure at published commit `1efc41686664ad2013172362591c342f307b8f9d`. The calendar's weekday and month grids now keep their natural height and scroll within the calendar. The verifier asserts that every day button fits inside its day cell before continuing.

## Method

`scripts/capture/verify-table-lifecycle.mjs` creates one isolated 5,000-row fixture in the staged instance configured by `/tmp/bb-studio-goal-staged/capture.env`. It owns a fresh headless Chrome profile on port 49569. The fixture has three status lanes and 28 populated days in the viewer's current month. A final clustered-date phase places all rows on one day. The script removes its table, browser and profile in `finally`.

One initial `Page.navigate` loads the application before measurement. All measured navigation uses history state and `popstate`, matching `openAppPath`, with `replaceState` to avoid growing browser history. Readiness waits for the requested view and two animation frames. No fixed navigation delay is included. A document token and `performance.timeOrigin` assert that every cycle stays in the same document.

Each cycle opens board, calendar and grid, then closes the table into its collection. Three warmup cycles precede 20 measured cycles. Three explicit garbage collections precede each closed-view sample. Samples include Chrome Performance heap, nodes, documents and listeners, plus live document elements, cards and dialogs. Mouse clicks open cards; input events edit titles and RPC reads verify persistence. Calendar month switching is checked. Desktop and 390px phone viewport captures check document containment.

## Baseline

[Raw baseline measurements](before/verification.json) include all 20 samples and browser version. Closed-view live DOM stays at 743 elements; Chrome Nodes stays at 1,011, listeners at 1,213 and documents at 14. No table card or row dialog remains mounted. Heap changes from 48.4MB to 49.8MB across measured cycles, about 2.8%. This bounded drift is not enough to identify a leak or prove none exists.

| View | Mounted cards | Live DOM elements | Repeated readiness median |
| --- | ---: | ---: | ---: |
| Board | 5,000 | 30,722 | 3,281ms |
| Calendar, 28 days | 5,000 | 5,903 | 1,159ms |
| Grid | 0 card buttons | 1,653 | 219ms |
| Closed collection | 0 | 743 | 37ms |

The clustered calendar also mounts 5,000 cards; its first ready sample is 1,510ms.

## Packaged fix

The final run uses published commit `c2bc4da5c2019fee6704b891a9d11e5ad954d472`. [Raw after measurements](after/verification.json) record its source, browser, view bounds, individual day bounds, interactions and all 20 lifecycle samples.

| View | Mounted cards before → after | Live DOM elements before → after | Observed readiness median before → after |
| --- | ---: | ---: | ---: |
| Board, three lanes | 5,000 → 150 | 30,722 → 1,705 | 3,281ms → 160ms |
| Calendar, 28 days | 5,000 → 280 | 5,903 → 1,713 | 1,159ms → 183ms |
| Calendar, one dense day | 5,000 → 10 | 5,903 → 931 | First ready: 1,510ms → 81ms |

These timings describe the fixture runs on a shared machine. The card and DOM reductions demonstrate bounded rendering; the timings do not isolate every source of latency.

Native mouse clicks use the last-page control and open row 5,000 in both board and calendar. Both views return to the first page, open another row, edit its title, close the dialog and verify the saved value through RPC. Calendar month switching returns to its populated month. The clustered calendar's last-page control also reaches row 5,000 at 390px width.

Every phone document stays 390px wide; board and calendar contain their horizontal scrolling. Board paging buttons measure 28×28px for previous/next and 36×28px for first/last. Calendar buttons measure about 42.4×28px on the phone. Desktop and phone checks assert that all day buttons fit within their day cell. The actual [board phone capture](after/board-mobile.png), [calendar phone capture](after/calendar-mobile.png) and [dense calendar final-page capture](after/calendar-dense-mobile.png) show the rendered controls, ranges and staged rows. The calendar captures scroll horizontally to the populated Thursday column.

The final lifecycle run never reloads its document and leaves no cards or dialogs mounted after closing. Closed-view counts decrease after the first measured sample and then remain fixed for cycles 2 to 20: 743 live elements, 1,013 Chrome Nodes, 1,217 listeners and 14 documents. Across all 20 samples, heap changes from 48.8MB to 49.8MB, about 2.2%. This run shows no growing closed-view DOM, document or listener count. It does not identify the small heap drift as a leak or establish a leak-free guarantee.

The fixture table is removed after each successful or failed run. The private browser process and profile are removed. A final staged RPC check finds zero lifecycle fixtures, and port 49569 is closed.

To reproduce the final checks:

```sh
source /tmp/bb-studio-goal-staged/capture.env
export BB_CAPTURE_CDP_PORT=49569
export BB_TABLE_EXPECT_PAGING=1
export BB_TABLE_LIFECYCLE_OUTPUT=docs/review-evidence/2026-10-02/table-lifecycle/after
export BB_TABLE_LIFECYCLE_SOURCE=c2bc4da5c2019fee6704b891a9d11e5ad954d472
node scripts/capture/verify-table-lifecycle.mjs
```

## Source checks

Kit typecheck passes. The complete kit suite passes 96 tests. Four focused board/calendar tests verify bounded mounting, final-row access, card open callbacks, drag payloads/drop changes, and page clamping after filtering or deletion.

## Limits

These are host headless Chrome measurements, not physical iPhone, WKWebView, thermal or battery measurements. Readiness includes local RPC and host scheduling. The machine is shared with native QA and builds; the two runs are sequential rather than a controlled performance lab. Timings are fixture observations, not a causal benchmark or service guarantee. Short fixture content and three lanes do not represent every user table. All table data still loads, filters and sorts locally. The 20-cycle GC run bounds this case only; it does not rule out every long-session leak, nor floating/embedded/native view lifetime. Chrome Nodes includes detached nodes; live document counts are reported separately.
