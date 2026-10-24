# Bot UI redo (surface C, desktop)

Codex made these Bot UI changes. This redo keeps their behaviour and tests
and fixes the visuals against Studio's existing design language: the
sidebar's own Threads section, Bot info's other sections (Automations,
Runners), and the kit's button, badge and dialog styles.

All renders come from a staged BB (stable BB 0.47.0, `scripts/staged-bb.mjs`)
with the same seeded data. **Before** is Studio at `1de68e82` (main), installed
from GitHub. **After** is this branch's Studio, installed into the same
instance from a copy of the worktree. `render.mjs` in this folder makes both:
`node docs/ui-redo/C/render.mjs before|after [view,...]`. Images are at
1440 px wide, dark and light; the running views are at 2x.

Two views use stubbed data, the same for before and after:

- **Move to machine** stubs `bot_runner_machines` and `bot_runner_preflight`
  in the page. A staged BB has no second machine. The stubbed messages are
  the pre-flight's own strings (`src/runner-machines.ts`).
- **Maintenance** stubs `bot_maintenance_get`. On stable BB 0.47 a real dry
  run stops with `this.deps.sdk.environments.pullRequest is not a function`
  (see "Needs Patrick's decision").

## Row states: running now vs scheduled (shared spec, desktop and iOS)

This follows `bot-row-states-spec.md` from the lead thread. iOS (worker B)
mirrors it. It applies to the rows under Running, Runners and Schedule in the
Bot sidebar, and to Bot info's Runners and Activity → Running.

| State | When | Logo | Ring | Right-hand text |
|---|---|---|---|---|
| Running | a thread is working now, or a runner is mid-run | full colour | a quarter-circle arc in `--success`, 2 pt stroke, turning once every 1.6 s (linear), over a 1.5 pt track at 25% | elapsed time, ticking each second: `0:42`, `12:05`, `1:02:10` (green) |
| Waiting for you | the thread needs the user; a runner's urgent report is unopened | full colour | still, `--warning`, 1.5 pt | the age, as before (a runner: its report's age) |
| Failed | the thread or the runner's last run failed | full colour | still, `--destructive`, 1.5 pt | `failed` in red (threads); runners show `next … · failed` |
| Waiting to start / machine offline | queued thread; runner whose machine is offline | dimmed (45%, greyscale) | hairline, muted at 30% | the age; runners show `offline` in amber |
| Scheduled / idle | a runner between runs; a finished thread | dimmed (45%, greyscale) | none | runners: `next 5:15 PM · quiet` (`· reported`, or `· failed` in red); threads: the age |
| Paused | a paused runner | dimmed (45%, greyscale) | none | `paused` |

- **Sizes**: the mark is a 16 pt box. The logo is 11 pt, centred. The ring is
  drawn inside the box: a 1.5 pt circle at r = 7.25; the running arc is a
  2 pt stroke at r = 7 with a dash of 11 and a gap of 33 (a quarter of the
  circle), rounded caps. Row height (28 pt) and alignment don't change.
- **Reduced motion**: the arc is hidden; the track becomes a full, still
  green ring, and a 6 pt green "live" dot sits at the logo's bottom-right,
  outlined 2 pt in the sidebar colour. The clock still ticks.
- **Only running rows move.** The old status ring pulsed on every active runner.
- **Narrow rows** (Patrick's call): the runner's name keeps the room. On a
  row narrower than 19 rem (304 pt), which is the sidebar, an idle runner shows
  just the time (`10:00 PM`, no `next`, no `· quiet` or `· reported`), and
  `· failed` stays. The full form shows where there's room (Bot info), and
  the outcome is always in the tooltip and the spoken label.
- **Time format**: `next` uses Schedule's format, the time if today, else the
  weekday and time (`Thu 9:32 PM`).
- **Spoken labels**: `Running for 12 minutes`, `Next run 5:15 PM, last run quiet`,
  `Paused`, `Failed`, `Waiting for you`, after the provider name.
- **Data** (new, optional fields): `running` on each runner (its thread is
  starting, active or stopping) and `runningSince` (ms) on runners and on
  `bot_activity` `inProgress` threads (the open timeline turn's start). A runner
  counts as running only when `running && state == "active"`. Urgent beats
  running. With no `runningSince`, show the ring without a clock.

### Running-state renders (Bots list, 2x)

Seeded state: Watch the ORBIT-42 canary is a thread the Bot started that
runs for ten minutes, and Release watch is a runner whose every run takes
ten minutes; both are caught mid-run. Deploy watch has an unopened urgent
report. Inbox watch is between runs. Draft Monday's status update is queued:
it now sits under Waiting to start, not Running.

| | Before | After |
|---|---|---|
| Dark | ![](before/running-dark.png) | ![](after/running-dark.png) |
| Light | ![](before/running-light.png) | ![](after/running-light.png) |
| Reduced motion, dark | ![](before/running-reduced-motion-dark.png) | ![](after/running-reduced-motion-dark.png) |
| Reduced motion, light | ![](before/running-reduced-motion-light.png) | ![](after/running-reduced-motion-light.png) |
| Motion (5 s) | ![](before/running.gif) | ![](after/running.gif) |

Before, every runner pulsed a green ring whether it was running or not,
and the time beside it was the last run, which read as the next one. After,
only the running thread and Release watch move and count up (`2:32`). Idle runners are grey and
say `next 10:00 PM · quiet`, shortened to `10:00 PM` in the narrow sidebar. Deploy watch is amber with its report's age.

## The redo, change by change

SHAs: the running states (71464043 to 485bd74b, and f30c07db) are on main
already; the rest are on `bb/ui-redo-c-claude-thr_zh3m4bfvxe`, rebased onto
origin/main. Dark is shown here; every view also has a `-light.png` beside it.

| Change | Codex SHA | What I changed | Commits | Before | After |
|---|---|---|---|---|---|
| Provider logos with state rings in the Bot sidebar | 76a8f831 | The 16 px ring with a glow, pulsing on every active row, is replaced by the shared row states (above). Only running rows move; idle rows are a dimmed grey logo with no ring. Bot info's runner rows use the same mark instead of a separate coloured dot. | 71464043, e8f94dc5, 5489be1e | [running](before/running-dark.png) | [running](after/running-dark.png) |
| Schedule agenda and runner last runs | 2ada6910, d19be782, 59715d17 | Runner rows say `next …` (shortened to the time in the sidebar), not the last run's time, which read as upcoming. Schedule's non-runner rows get their kind's icon (check-in, reminder, watcher, as in Info's Automations) in the same 16 px slot as the provider marks, so every name starts at one line. Times use tabular figures. "N done" and Show archived are full 28 px rows with an icon slot; Show archived gets loading, empty and error states. Offline machines say so in amber. Queued threads get Waiting to start instead of sitting under Running. | 5489be1e, a33c5de8, 485bd74b | [sidebar](before/sidebar-dark.png) | [sidebar](after/sidebar-dark.png) |
| Runner machine picker, Move to machine, pre-flight, install and sign-in | 49dc896c (UI) | The dialog has its own description for a move ("keeps its job, schedule and reports…") and "This server" instead of "Server machine". The pre-flight shows inline in one box: checking (spinner), blocked with **Install Codex on Mac mini** or the sign-in command in code, the warnings to review, or ready ("Codex is installed and signed in"). Before, the warnings showed only after Move, run together on one line. Check again sits in the box. The confirmation lists the warnings. Runner rows show the machine with an icon, and Move to machine… gets one. | 5489be1e | [ready](before/move-ready-dark.png), [confirm](before/move-confirm-dark.png), [install](before/move-install-dark.png), [sign-in](before/move-signin-dark.png), [runners](before/runners-dark.png) | [ready](after/move-ready-dark.png), [confirm](after/move-confirm-dark.png), [install](after/move-install-dark.png), [sign-in](after/move-signin-dark.png), [runners](after/runners-dark.png) |
| Collapsed profile and cache time | affe9098 | Profile changes is a chevron disclosure; its rows are ruled, with a 28 px Revert. The header's cache time chip is 28 px tall, like the controls beside it, with a focus ring and an open state. | 5d167b46 | [info](before/info-dark.png), [changes](before/profile-changes-dark.png) | [info](after/info-dark.png), [changes](after/profile-changes-dark.png) |
| Bot info profile and thread header | 2fd49a17 | The profile is the page's head: the name as a 16 px semibold title with its status, and Edit plus the ⋯ menu on the same row. Before, the ⋯ sat alone on a row of its own, under a "Profile" label and a divider. The Bot info button in a Bot thread's header is a borderless chrome button like its neighbours, not a bordered, shadowed one. Stop's square is filled, so it reads as stop rather than a checkbox. | 5d167b46, 696f63bb | [info](before/info-dark.png), [edit](before/profile-edit-dark.png), [header](before/sidebar-dark.png) | [info](after/info-dark.png), [edit](after/profile-edit-dark.png), [header](after/sidebar-dark.png) |
| Maintenance panel | 338c453d | Rebuilt as a ruled section like Automations and Runners: Dry run and Run now in the heading. The switch has an Off, Dry run or Live badge and one plain line ("until Sat 7:41 PM", not "10/22/2026, 8:29:26 PM"). Rules sit behind a chevron with "5 of 6 on", and the budget reads "Keep the Memory page under [8000] words". The last run shows its age and summary, its actions behind a chevron with a count, Needs your call rows with Open, and suggestions with Adopt. Raw `<details>` triangles, underlined links and loose lines are gone. | 064f2f97 | [maintenance](before/maintenance-dark.png) | [maintenance](after/maintenance-dark.png) |
| Skill history | 0de954ac (UI) | A chevron disclosure, not `<details>`. Each version is a ruled row (name, Deleted or warning badges, age) that opens to a diff on a code surface with added lines green and removed lines red. Warnings use the warning colour and icon, not hard-coded amber, and Revert is an outlined button. | 5d167b46 | [skills](before/skills-dark.png) | [skills](after/skills-dark.png) |
| Also: submenu chevron | (lead's note) | The kit's submenu trigger had no chevron, so Versions (artifacts) and Move to looked like plain items. It's drawn once in the kit. | f30c07db | | |
| Also: muted text in menus, dark | (lead's note) | BB's dark theme sets muted text at 78% lightness against 81% for menu text, so descriptions and labels read as items. Inside Studio's dropdown and context menus only, muted text is the menu's text mixed 82% toward its background. That reproduces light mode's own step exactly (44% on 32%) and gives dark the same step (70% on 81%). | 6c7883e1 | [menu](before/menu-dark.png) | [menu](after/menu-dark.png) |

The README captures that drive Maintenance and Skill history were updated
for the new toggles; their data assertions are unchanged.

## Review-only commits

| SHA | What it does | Visual notes |
|---|---|---|
| 9e7a532e | Refetches live data after a realtime reconnect | None; no visual change. |
| f3fce5d6 | Typed live RPC data tied to readers | None; types only. |
| ef2aa9e0 | Studio items sidebar refreshes on focus and drops stale loads | Flag: its new error line, "Couldn't load Studio. Retry", has a bare `<button>` for Retry, with no hover, underline or focus ring, inside red text. It also shows above the stale list rather than in its place. Not redone: it's the Studio items sidebar, outside the Bot UI, and another surface may own that file. A quiet fix: `underline underline-offset-2 hover:text-foreground` on Retry. |
| 30681f65 | Health "seen" survives a failed localStorage write | None. |
| 6eb56cc4 | Setup summary replies apply in request order | None. |

## Needs Patrick's decision

1. **Maintenance dry runs fail on stable BB.** On BB 0.47.0 a dry run ends
   with "Dry run stopped: this.deps.sdk.environments.pullRequest is not a
   function", so it never lists anything. That's a compatibility bug, not
   UI; the Maintenance renders use stubbed data because of it.
2. **Narrow runner rows** (decided in the lead thread): the sidebar shows
   `10:00 PM`, and `next … · quiet` only where there's room.
3. **"16 pt logo"** in the shared spec, read as a 16 pt mark box with an
   11 pt logo and the ring inside it, so row alignment doesn't change.
4. **Pause and Stop appear twice** in Bot info: in the action row and in the
   ⋯ menu. That predates these commits; I left both. Dropping them from the
   menu would make it shorter.
5. **New optional contract fields** (`running` and `runningSince`) are added
   and the iOS Swift contract is regenerated; worker B decodes them.
