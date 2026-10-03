# Watch phone-reboot and transport recovery

This follow-up used a new empty paired iPhone/Watch simulator, committed source
`666c458`, iOS 27.0 and watchOS 27.0. Only staged BB at
`http://127.0.0.1:49486` was used. Both copied source fallback URLs and all four
app/group preference domains selected that server before launch. The private
BBClient initializer also rejected clients outside that staged endpoint.
[Environment](environment.json) and [persisted origin check](origin-check.json).
No reply, approval, stop, or other agent action was sent.

## Actual reboot result

The initial Watch activation did not receive its completion callback during a
30-second check. [The activation log](initial-activation.log) records the
activation request without completion. Relaunching after registration settled
loaded the staged inbox in 6.7 seconds. This first-install simulator behavior
is separate from the phone-reboot result.

After the phone was shut down, the Watch app was relaunched to discard its
in-memory inbox. WatchConnectivity still reported the phone reachable and
accepted messages, but delivered neither replies nor errors during the first
30 seconds. [The Watch remained pending](phone-off-pending.png).

Booting the phone alone did not restore the list within 30 seconds. Opening
its app did not restore the Watch list within the next 20 seconds. Tapping the
visible **Retry** control then fetched the staged inbox in **4.2 seconds**:
[measured state](retry-after-reboot-state.json),
[recovered inbox](recovered-after-reboot.png).
This proves manual recovery through the real phone relay after a full reboot;
it does not claim automatic phone-foreground recovery.

With the final source installed, a second full phone shutdown/reboot was
exercised. After opening the phone app, sending the Watch app to its Home
screen and foregrounding it again loaded the inbox in **14.9 seconds**:
[measured state](watch-foreground-state.json),
[foreground recovery screenshot](watch-foreground-recovered.png).
The final offline deadline check produced its explicit timeout and Retry
within **18.3 seconds** including activation: [state](final-offline-state.json).

## Changes and checks

`WatchModel.swift` now bounds activation at 10 seconds and each relayed reply
at 15 seconds. Completion, cancellation and deadline share one completion
guard; completion cancels the deadline and cleans up activation waiters.
Late replies cannot resume a continuation twice or apply an origin correction.
A server-selection UUID also rejects replies from before an A→B→A switch.
Normal task cancellation is not shown as a user-facing inbox error.

A timed-out read gives an explicit [error with Retry](deadline-retry.png).
A write timeout or cancellation says the result is unknown and asks the user
to check the phone/thread before resending. Writes are never automatically
retried. Inbox loading follows server selection and active scene state, so
returning to the foreground or changing servers starts a fresh read.

`WatchApp.swift` retains a submitted draft on failure/unknown outcome. It
clears the draft only after confirmed success, only for a draft submission,
and only if the text still matches. Quick replies never clear an unrelated
draft. This narrow UI change was source-reviewed and compiled; no real send
was used to test it.

The [temporary Watch transport probe](WatchTransportProbe.swift) ran on the
Watch simulator against the actual completion helper and origin correction
method. [All nine checks passed](transport-probe-result.json): reply/error
completion, deadline completion, cancelled deadline after reply, cancellation,
pre-cancelled operation not starting, late-reply side effects rejected, and
stale/current origin correction including A→B→A.

Both the final production Watch build and the temporary probe build passed.
`git diff --check` and evidence-link checks passed. The
probe-only root disables WC activation and injects no network mutations. The
final private production build removes those test hooks. The prior
`watch-runtime/WatchLoadProbe.swift` received only the parameter changes needed
for the new selection-UUID argument; its earlier results were not rewritten.

## Boundaries

Physical-device background wake, complication delivery and reply/approval
outcomes remain outside this run. The initial missing activation callback is
not attributed to app code; the deadline now prevents it from leaving an
unbounded spinner. UI state checks assert staged preferences before reading
accessibility labels. All screenshots contain staged data only.

The private pair was shut down, unpaired and deleted after verification. No
existing simulator, physical device, global Xcode setting or production server
was changed. Source and evidence are left for root review; no commits or pushes
were made by this lane.
