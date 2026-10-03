# Watch reply delivery and draft retention

Live verification on 2026-10-03, approximately 05:44–05:59 UTC. Watch production source was the published `175b675` implementation. No production source changes were needed.

## Isolation and method

Created a fresh empty iPhone 18 Pro + Apple Watch Series 12 (46 mm) pair, running iOS 27 / watchOS 27. Built a private committed source snapshot with both default server URLs changed to `http://127.0.0.1:49486` and a `BBClient.init` precondition rejecting every other origin. App and app-group preferences on both devices were read back before launch; see [isolation.json](isolation.json). The phone's preferences were verified again after reboot. No existing simulator or physical device was used.

The only thread opened or messaged was the newly created staged fixture `thr_6qedhhkwm4` in staged Orbit project `proj_su3dznrbpw`, titled **Watch actions QA 0542**. Its initial Codex `gpt-6.1-sol` / low prompt required a fixed `READY` response, then `WATCH_QA_OK` for subsequent messages, with no tools. The fixture initially returned `READY`.

Actual Watch UI actions used AXe taps and the system Watch keyboard. Requests traversed the production WatchConnectivity phone relay. Direct HTTP was used only to create/name the fixture, read its timeline, and delete it afterward—not to send either tested reply. The private app build passed.

## Results

| Case | Live result | Evidence |
|---|---|---|
| Successful typed reply | Entered `T`, tapped keyboard Done. Server received exactly one `T`; assistant returned `WATCH_QA_OK`. Reply field cleared after success. | [Keyboard](01-reply-entry.png), [Watch delivery and empty field](02-reply-delivered.png), [timeline](timeline-after-first-reply.json) |
| Phone shuts down before submit | Entered `Draft`, shut down only the private phone, tapped Done. Watch retained the draft and displayed “The result is unknown because iPhone did not respond. Check your phone or thread before resending.” | [Draft before submission](03-offline-draft-entry.png), [retained draft](04-offline-result.png), [unknown-result warning](05-offline-error.png) |
| Reconnection does not resend | Rebooted private phone, verified its staged preferences, reopened phone app, foregrounded the existing Watch process. At 161.9 seconds after failed submission, timeline still contained only the original `T`; no `Draft` or duplicate `T`. | [Retained draft after reconnect](06-reconnected-draft.png), [bounded no-duplicate observation](timeline-after-reconnect.json) |
| Quick reply preserves unrelated draft | Tapped **Yes** while the field still contained `Draft`. Server received one `Yes` and assistant returned `WATCH_QA_OK`; Watch continued showing `Draft`. | [Successful quick reply with retained draft](07-quick-reply-keeps-draft.png), [final exact timeline](timeline-final.json) |

The final conversation contains only the initial fixture prompt, `READY`, `T`, `WATCH_QA_OK`, `Yes`, and `WATCH_QA_OK`. The timeline contains conversation and provisioning-system rows, with no tool rows.

## Limits and cleanup

The simulator ignored AXe hardware text injection; visible keyboard taps worked. Consequently the first actual test message was the benign one-character `T`, rather than the longer intended phrase. This does not establish dictation or physical-keyboard behavior.

Initial fresh-pair activation/read callbacks timed out. Relaunching the paired apps and using the visible Retry restored the inbox. Phone-off testing exercised the **unknown outcome** deadline with stale reachability, not an immediate known-unreachable rejection. The lack of automatic resends was observed over the recorded bounded interval and confirmed again after a successful quick reply; it is not an indefinite soak test. Approval actions and real hardware were not tested.

Only the dedicated fixture was deleted through the staged API. Both owned simulators were shut down, unpaired and deleted; see [cleanup.json](cleanup.json). No existing user thread was replied to, approved, stopped or deleted. No source edits, commits, pushes, package changes or global Xcode settings changes were made.
