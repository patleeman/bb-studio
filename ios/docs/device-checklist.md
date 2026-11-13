# Device checklist: BB Studio 0.2.0

Run on the iPhone (and the Duo where marked) with the 0.2.0 TestFlight build,
against the live BB with the current Studio and Mobile plugins. Tick each box;
note the build number and anything that fails in BUGS.md.

Build: ________  Phone: ________  Duo: ________  Date: ________

## Before you start

- [ ] TestFlight shows 0.2.0 and the build; BB's push device list shows "BB Studio 0.2.0 (<build>)" for this phone.
- [ ] Notifications allowed; Live Activities on (Settings → BB Studio).
- [ ] `bb mobile status` says APNs is ready (Sandbox & Production key).
- [ ] At least two Bots, one with a running worker, for the steps below.

## Steps 1–3: import, contracts, data

- [ ] First launch with no network: the Bot list shows from cache at once
      (`bot_spaces` and `bot_threads_view` caches), then refreshes.
- [ ] Turn Tailscale off: the connection banner shows with Open Tailscale and
      Retry. Back on: everything refreshes without a relaunch.

## Step 4: navigation shell

- [ ] Launch opens the current Bot's Main; Back shows the Bot's list.
- [ ] Switch Bots by the dots and by swiping the header.
- [ ] A Bot that needs you has an amber dot; its needs-you row is amber.
- [ ] Settings → All BB threads lists raw threads read-only.

## Step 5: conversations

- [ ] New conversation starts and opens; it shows in the list.
- [ ] Reply in thread opens the sheet; the "💬 N replies" row appears.
- [ ] Fork conversation opens under its parent with "Forked here".
- [ ] Header model chip and ··· → Model change the model; ··· → Finish
      conversation finishes it.
- [ ] A `[PASS]` turn reads "Quiet check".

## Step 6: workers

- [ ] "N workers from here" opens the list; a worker opens read-only with
      status, branch and the owning conversation.
- [ ] "Ask the Bot about this worker…" sends and lands in the right
      conversation.

## Step 7: approvals

- [ ] A worker approval shows as a card in its conversation; Approve resolves it.
- [ ] The same from the lock-screen notification (long-press → Approve / Deny).
- [ ] Airplane mode, tap Approve: it fails visibly and is not queued.

## Step 8: Bot pages

- [ ] Memory, Library, Todos, Automations and Archive open from the list
      header and load; Archive → Reopen brings a conversation back.

## Step 9: links

- [ ] A `bb://` link in a reply opens natively; a missing one says "Not found".
- [ ] `bbstudio://conversation/<id>` from Safari opens it.

## Step 10: cleanup

- [ ] No Threads tab; no project picker on new conversations; no side chat.

## Step 11: the look

- [ ] On Air graphite by default; Settings → Look switches Classic and scene
      themes; scene stills shift with tilt.
- [ ] Presence: idle still, live while thinking or working, amber when it
      needs you. Low Power Mode stops live scenes.

## Step 12: native surfaces

Widgets:

- [ ] Add Status, Bot and Work widgets. Edit Widget → Bot lists your Bots;
      empty follows the current Bot.
- [ ] Each shows the chosen Bot's presence still, its needs-you and running
      rows, and opens the right conversation.
- [ ] Large Bot widget with a worker approval waiting: Approve and Deny work
      without opening the app.
- [ ] Work widget with only approvals waiting says "N waiting on approval",
      never "0 attention" (B18).

Live Activity and Dynamic Island:

- [ ] With the app open, start a turn: a Bot activity appears (island compact:
      presence still and worker count).
- [ ] Lock the phone: the lock-screen banner shows the Bot's name, "N workers",
      "Main · latest line" and, when something needs you, the reason in amber.
- [ ] Long-press the island: expanded view; with a worker approval, Deny and
      Approve work.
- [ ] Tap the activity: it opens the conversation.
- [ ] When the Bot goes idle with the app open, the activity ends.
- [ ] `bb mobile live-activities` lists this phone's push-to-start token per
      Bot, and an update token while an activity runs.
- [ ] The Talk recording activity still appears while recording.
- [ ] (Once Studio sends pushes, `docs/live-activity-server.md`) with the app
      closed, a turn starts, updates and ends the activity.

Share:

- [ ] Share a link from Safari: "Send to <Bot>", Main selected; it lands in Main.
- [ ] Pick another open conversation, then New conversation; both work, with
      a photo attached.
- [ ] With two Bots, the Bot picker switches the list; the choice is remembered.

Voice:

- [ ] The waveform in a conversation's header starts hands-free as that
      conversation (its title shows as the identity).
- [ ] The Action button / "Talk to Bot" talks to the current Bot's Main.

## Step 12b: Studio items

- [ ] Pinch-zoom, pan and double-tap on: a design screen (Fit and Fill), an
      image artifact, an HTML artifact, a whiteboard, and a full-screen image
      in a reply.
- [ ] Design: Rename; a comment's menu Send to Agent, Resolve, Delete.
- [ ] Related → Add Comment on a page, a recording and an artifact.
- [ ] A link inside an HTML artifact opens Safari; a `bb://` one opens in the app.
- [ ] Mini app: Rename.

## Step 12c: bug checks only a device can do

- [ ] **D3** (B1, B17) Duo: fold and unfold with the keyboard up, a few times;
      no crash. Check the inner layout and that the fold keeps your place.
- [ ] **D4** (B4, B5) Turn on Settings ▸ Diagnostics ▸ Scroll log; drag
      during a busy turn and reopen the Bot chat on the outer screen with an
      empty composer. If it jumps or shows black, share the log.
- [ ] **D5** (B6, B17) Duo inner screen split with Safari: the composer rests
      at the bottom with no keyboard.
- [ ] **D6** (B7, B13) A 5-minute hands-free session on the Duo: no dropouts,
      voice from the speaker, the composer mic works after. The screen is clear
      of the status column.
- [ ] **D7** (B8) Answer a secret request and a question in the Bot chat: the
      field keeps focus while typing.
- [ ] **D8** (B12) Type in a long, busy conversation: no lag.

## Step 13: ship

- [ ] Input area in a conversation: one compact row, mic prominent, no model
      button, no expand-to-page.
- [ ] Watch app and Siri intents still work (no changes expected).
- [ ] The Mobile relay was updated with the app (README "Connection").
