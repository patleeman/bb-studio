<!-- DRAFT for get-bb/bb. Not posted. -->
# Treat a final `[PASS]` as a silent turn (no parent notice, no push, no unread)

## Problem

Scheduled and event-driven agents (heartbeats, check-ins, automations,
runner threads) often finish with nothing to say. Providers don't allow an
empty final assistant message, so the agent has to write something. Every
such turn then:

- posts a `child-completed` system message (`[bb system] @thread:... completed: ...`)
  into the parent thread, which wakes the parent agent;
- sends a phone push through push-notifications;
- marks the thread unread and makes the reply its latest-message preview.

For a heartbeat that runs several times a day this is mostly noise.

## Evidence

- The BB Nightly bundle (`bb-app` server, app and host-daemon dist) has no
  handling for `[PASS]`, `NO_REPLY` or a silent or suppressed turn. Push,
  unread and child notices fire for every completed turn.
- #3723 (closed as a duplicate, not planned): no way to suppress the
  child-completed message on a parent thread.
- #3050 (open): deduplicate covered child completions and result delivery.
- #4487 (open): let a child tell its parent only when it finishes.
- BB Studio works around this on its side: Studio Mobile drops pushes for
  `[PASS]`, its iOS app hides the reply, and Studio runners are spawned
  without a parent so BB posts no child notices.

## Proposal

Adopt one convention: a turn whose final assistant message is exactly
`[PASS]` (trimmed; tolerate surrounding whitespace, backticks and markdown
emphasis; case-insensitive) is silent.

For a silent turn BB would:

1. post no `child-completed` notice to the parent thread;
2. send no push notification;
3. leave the thread's unread state and latest-message preview unchanged;
4. render the message as a faint "Passed" row in ThreadChat (or collapse it).

Failures, stops and needs-attention notices are unchanged. Optionally, expose
`isSilentTurn` on `thread.idle` / turn events so plugins can follow the same
rule.
