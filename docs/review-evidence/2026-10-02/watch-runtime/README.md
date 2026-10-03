# Watch runtime review

The official arm64 watchOS 27.0 simulator runtime (24R362, 3.83 GB) installed
successfully using Xcode's `-downloadPlatform watchOS`. A new iPhone 18 Pro
(iOS 27.0, 24A434) and Apple Watch Series 12 46mm were paired and booted.
The apps built from a private copied project, with separate derived data.
No existing simulator or physical device was used.

## Verified

- Phone and Watch apps launch. The Watch displayed the staged Orbit thread list through WatchConnectivity;
  see [the recovered staged inbox](watch-recovered.png).
- Two [temporary delegate tests](WatchRelayRuntimeTests.swift) call the actual
  `PhoneRelay` delegate. A matching staged origin reads `/api/v1/projects`,
  decompresses the reply, and finds Orbit. Different and missing origins reject
  a POST with 409 and return the selected origin before network forwarding.
  [Final result: two passed](relay-test-result.json).
- Tests assert that staged BB is already selected before running. They restore
  that captured staged origin, never an app default.

## Reproduced and fixed recovery gap

A fresh Watch inbox can call its transport after activation but before the
phone becomes reachable. It shows [iPhone not reachable](watch-unreachable.png).
The real WCSession then reports `reachable: YES` approximately 150 ms later,
but logs show that `PhoneTransport` does not implement
`sessionReachabilityDidChange:`. The inbox remains on the error because its
initial `.task` has already ended. A simulated pull gesture did not recover it.
See the [filtered WatchConnectivity log](reachability.log).

`apps/ios/Watch/WatchModel.swift` now reloads on the reachable transition,
without polling. `WatchApp.swift` provides an accessible Retry button. The
rebuilt Watch recovered automatically to the staged inbox; see
[the recovered inbox](watch-recovered.png). With the private phone shut down,
[Retry is visible](watch-retry.png). The staged thread opens with reply controls
in [the thread view](watch-thread.png); no reply or approval was sent.

Load generations and origin checks prevent an earlier request's success,
error or cleanup from overwriting a newer load or a changed server. A delayed
origin-correction reply also applies only while the request's original server
is still selected. The [temporary continuation probe](WatchLoadProbe.swift)
runs the actual WatchModel on the Watch simulator with controlled transport
completions, checking stale errors, current loading state and final state both
within one server and across a server switch. It also exercises stale/current
origin corrections through the same helper used by PhoneTransport.
[All eight probe checks passed](watch-load-probe-result.json). Both the
production Watch build and the temporary probe build succeeded.

## Harness isolation incident

The first temporary test cleanup restored the app's default server into the
fresh simulator's app-group preferences. That value overrode later command-line
launch arguments; a subsequent accessibility read exposed non-staged thread
titles. Both owned apps were stopped immediately. No reply or approval was
sent and no production cleanup was attempted. No private thread-title evidence
is retained here.

The private apps were uninstalled, their copied source fallback URLs were
changed to `http://127.0.0.1:49486`, and both app and group preference domains
were explicitly set to that staged origin. Subsequent tests assert the origin
before making calls. Persisted group preferences were checked before final
verification. The committed source defaults were not changed.

## Limits and reproduction

The screenshots and paired launch establish actual Watch runtime operation;
the delegate tests separately establish request-origin handling. They do not
prove a full stale-origin exchange over WatchConnectivity, successful reply or
approval delivery, background wake behavior, physical-watch battery behavior,
or complication delivery. The staged thread navigation was checked, but reply/approval actions were
not exercised. A full phone shutdown/reboot reconnection was also attempted;
the inbox had not recovered by the first bounded check, so that lifecycle
remains unverified separately from the successful initial reachable-transition
recovery.

Use only a new private phone/Watch pair. Copy `apps/ios` into a temporary
directory, set both copied `Shared/AppGroup.swift` and `Shared/BBClient.swift`
fallback URLs to staged BB, and set both app/group preference domains before
launch. Copy `WatchRelayRuntimeTests.swift` into the private Tests directory,
run `xcodegen generate`, then `xcodebuild test -scheme BBStudio -destination
'id=<private-phone>' -only-testing:BBStudioTests/WatchRelayRuntimeTests` with
`DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`. Keep staged BB
running on port 49486. AXe UI inspection works when invoked with that same
environment; the MCP server inherited CommandLineTools and could not resolve
its Xcode installation.

Only the two owned review simulators were shut down and deleted after the run.
The downloaded watchOS runtime remains installed. No commits or pushes were
made by this review lane.
