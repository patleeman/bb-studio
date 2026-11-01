# Attention Router on iOS: before and after

Renders of the iOS app before and after the Attention Router UI, for Patrick
to review before anything ships. They are unmodified renders of the built
Debug app on owned simulators (an iPhone 18 Pro, and an iPhone Duo for the
folded 466 × 678 and unfolded 951 × 669 layouts), from local fixtures only:
`-qaBotDemo chat|duo -qaLoopsDemo` serves the mockups' loops from an
in-memory store, so no server, agent or location was used. The Bot is the
fixture's "Juniper"; on Patrick's phone it is his Chief of Staff.

The design reference is the approved mockups at `bb360a85` on
`bb/attention-router-mockups-thr_6pgxbhb8ny` (docs/attention-router/mockups).

## Before

The same chat (a morning message and `::loop{id}` lines, as the Bot posts
them) in today's app: the directives are hidden, so each card is an empty
bubble and the morning card loses its list. There is no Loops and no Places.

| | Render |
| --- | --- |
| iPhone, Bot chat | [before/iphone-bot-chat.png](before/iphone-bot-chat.png) |
| Duo folded, Bot chat | [before/duo-folded-bot-chat.png](before/duo-folded-bot-chat.png) |
| Duo unfolded, Bot overview and chat | [before/duo-unfolded-bot-chat.png](before/duo-unfolded-bot-chat.png) |
| iPhone, Settings | [before/iphone-settings.png](before/iphone-settings.png) |

## After

### Cards in the Bot chat

| State | iPhone | Duo folded | Duo unfolded |
| --- | --- | --- | --- |
| Morning card: Calendar, On today's list (top 5 and "3 more in Loops"), Good to know | [png](after/iphone-morning.png) | [png](after/duo-folded-morning.png) | |
| Decide, do and read cards (Done and Snooze on the phone, Hand off and Drop behind ⋯) | [png](after/iphone-cards.png) | [png](after/duo-folded-cards.png) | [png](after/duo-unfolded-cards.png) |
| Snooze sheet (Later today, Tonight, Tomorrow, This weekend, When I'm home, Pick a time…) | [png](after/iphone-snooze.png) | | |
| Choose… sheet for a decision with more than 3 options | [png](after/iphone-choose.png) | | |
| Handed off ("Kensico lead is on it", Open thread, Take back), snoozed and collapsed with Undo | [png](after/iphone-progress.png) | | |
| Attention Router off: quiet placeholders, no Loops switch | [png](after/iphone-off.png) | | |

### Loops

| State | iPhone | Duo folded | Duo unfolded |
| --- | --- | --- | --- |
| Chat \| Loops switch and the Loops list (Add a loop, area chips, owner menu, sections) | [png](after/iphone-loops.png) | [png](after/duo-folded-loops.png) | [png](after/duo-unfolded-loops.png) (All loops in the left pane, the chat on the right) |
| A row's buttons and its ⋯ menu (Change trigger, Surface now, Hand off…, Drop) | [png](after/iphone-row.png) | [png](after/duo-folded-row.png) | [png](after/duo-unfolded-row.png) |
| Discuss, first in a row's ⋯ menu: it switches to Chat and drafts the loop's `::loop{id}` line and "About: <title>", unsent (dark; `LoopsUITests.testDiscussPhone` saves `iphone-row-discuss` and `iphone-discuss-draft`) | not committed | | |
| Change trigger: Place selected, Arrive, Send to iPhone on | [png](after/iphone-trigger.png) | | |
| Empty | [png](after/iphone-loops-empty.png) | | |

### Places (Settings)

| State | iPhone |
| --- | --- |
| Settings with the new Attention Router ▸ Places row | [after/iphone-settings.png](after/iphone-settings.png) |
| Places: the switch, Home, Office, saved places, location access and "4 of 20" | [after/iphone-places.png](after/iphone-places.png) |
| The "Allow Always" explanation shown before iOS asks (no system prompt was shown) | [after/iphone-permission.png](after/iphone-permission.png) |
| Add a place: map pin or current location, radius | [after/iphone-place-editor.png](after/iphone-place-editor.png) |

Lock-screen notifications are not rendered: the simulator would need
notification permission and an APNs payload. Their buttons are covered by
unit tests (`LoopsTests`) and need a device test.

## How these were made

```sh
# After (this branch): offline UI tests write the PNGs.
TEST_RUNNER_BBGO_STATES_OUT=<folder> xcodebuild test -scheme BBStudio \
  -destination id=<iPhone or Duo simulator> CODE_SIGNING_ALLOWED=NO \
  -only-testing:BBStudioUITests/LoopsUITests
# The Duo's renders land in the app's Documents as loops-duo-*.png.
```

The before renders come from a checkout of `c0eff51a` with the same loop
messages added to its Bot fixture (not committed), captured the same way.
