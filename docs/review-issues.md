# Studio review issue ledger

This ledger tracks the remaining work from the [2 October review](codebase-review-2026-10-02.md).
The repair goal is active. A passing unit test does not close a required live
check; an unavailable device or SDK capability remains an explicit open item.
Completed first-pass fixes and their evidence remain in the review report.

| ID | Type | Issue and acceptance criterion | Status / owner |
| --- | --- | --- | --- |
| M1 | Defect | Server switching isolates native caches, drafts, widget/share state and captured in-flight writes; unknown legacy drafts remain recoverable without guessing their origin. | Storage isolation be29216 and action isolation 06dd4d6 pushed. Native tests/build pass; physical switching remains Q1. |
| M1b | Defect | Multi-step native actions keep one server client after awaits; previous-server completions cannot navigate the new server. | Verified source 06dd4d6: captured clients and origin-gated completion across action flows, delayed A→B regression tests. Combined native checkpoint: 46 tests, 1 skip, app/extensions/watch build. |
| M2 | Recovery | Restart/force-quit recovery finds native audio left between capture and committed enqueue, preserves its origin and prevents false completion. | Source de0e8a5 pushed: capture journal, interrupted queue reconciliation, export and explicit per-file discard. 57 native tests with 1 skip, zero failures; real-device interruptions remain Q1. |
| M3 | Recovery | Unsaved native Page edits survive view destruction/restart with explicit conflict/retry behavior. | Verified source c7b8ffa: server/page-scoped atomic drafts, exact-base conflict checks, pending-save recovery, retained later typing and explicit export/discard. Combined native suite: 71 tests, 1 existing skip, zero failures. Physical storage behavior remains Q1. |
| D1 | Recovery | Unsaved Draw edits survive reload/crash and recover without overwriting newer server content. | Verified: source 30c2869, evidence cdba575. Actual offline canvas edit/reload, second-writer conflict, single-copy retry after lost response, quota retry and separate-tab drafts pass. Browser data clearing/power loss remain durability limits. |
| T1 | Recovery | Browser Talk preserves durable chunks, reports unrecoverable storage failures honestly, and offers download before close. | Verified: source a73d1dd/35bb73f/4ab0ea8, evidence cdba575 plus paused-export followup. Real mic/IDB/reload, quota+marker failure, write-ahead capture refusal, retained download/retry and explicit acknowledgement pass. 132 tests/types/build. OS eviction/Safari remain Q1/Q4 boundaries. |
| S1 | SDK | Shared provider results distinguish absent data, partial snapshots and unavailable providers; picker and hub retain independent storage policies. | Pushed as 1c0a2d6; picker/hub outage, partial, uninstall and recovery tests pass. |
| S2 | SDK | Search retries only affected providers in coalesced background work; interactive searches do not wait for whole-suite repair; freshness is visible. | Verified source 4164c14/653b2cb/6c5e012, evidence 8190101: cached body search survives provider/discovery/status outages; automatic plugin lifecycle repair, Tab/ShiftTab/Escape, external focus attempts, zero-result navigation and 390px bounds pass. |
| S3 | SDK | Reusable provider tests cover read/list/get, change IDs, deletion, truncation, offline state and optional Studio installation across providers. | Verified in 7b4e64c: production Draw, Tasks/boards, Pages, Talk/dictations, Artifacts, Bots/Channels and Tables fixtures. 131 core tests pass. Found/fixed missing Tables row201+ search text. Transport/audio/bot setup are separate integration boundaries. |
| S4 | SDK | Canonical item/mention references are shared, extensible and compatible with older links and opaque IDs. | Verified: f2abe0a, packed cc3065e. Kit/core/Pages tests pass; raw percent/colon IDs, registered routes, legacy/custom namespaces, one-time URL decoding and bounded metadata lookup. Absolute URLs require a trusted matching origin. |
| S5 | SDK | Host-dependent UI code is isolated in cleanup-safe adapters using available public capabilities, with a stable-host regression loop. | Reactions verified in 09366a5. Native companion host patch and optimized-host proof d372405 expanded in ca73b87 to six core commits, including verified repeated split/swap with both original editors and pins retained. Authoritative upstream access remains READ; released SDK lacks those APIs. Initial-main adoption b241546/75ad5f5 and live evidence 773018c pass. Native main-thread adoption and remaining workbench checks stay with the host owner. |
| S6 | SDK | Native handwritten plugin endpoints are inventoried and covered by generated contracts or parity tests, including Feed. | Source 420f0fb: generated Feed contract, 147-call method parity gate and repaired stale Chat lookup. Payload parity 7977d0b adds 11 schema-validated fixtures and six native transport tests; fixed fractional task-reminder milliseconds. Combined 71 native tests pass with 1 existing skip. Representative coverage; external host endpoints and unrepresented payloads remain separate. |
| P1 | Product | Explicit Explore → Task preserves source/project/space, is idempotent and supports Tasks being absent. | Verified: source 3318221, live evidence 09366a5. Actual Track/Open, concurrent same-task retries, project/source/space inheritance and disabled Tasks recovery pass. |
| P2 | Product | Feed search, unread/date filters and reader-position restoration work across discussions and reloads. | Verified: source 3979fe1, live evidence 523ab72. Boundary dates, combined filters, independent Needs You, keyboard/phone bounds and 120-loaded-post position restoration pass. |
| P3 | Product | Tables agent query traverses more than 100 rows predictably and reports pagination/total state. | Verified: source 38f64b5, live evidence 523ab72. 1,200 unique rows across 12 pages; mutation rejects stale revision. UI rendering performance is tracked separately in Q6. |
| P4 | Product | Reactions has one configuration editor and honest saved/applied/error states; applying cannot strand a disabled plugin. | Verified: d0cba3d/feda63e, live evidence 09366a5. Native settings/reload and user/assistant/selection toggles pass. Right-click menu interaction remains in Q4. |
| Q1 | Verification | Device audio interruption/background/low-storage and server-switch delivery have recorded results against isolated fixtures. | Open — phone is now reachable and paired, but devicectl lockState reports passcodeRequired. Unlock was requested; isolated simulator and code work continue. |
| Q2 | Verification | Real APNs delivery, exact approval action, stale-action rejection and clear behavior verified without touching user work. | Open — needs dedicated device/relay fixture |
| Q3 | Verification | Share extension and Watch pairing/transport exercised; destinations and snapshots remain server-scoped. | Partial — Share data-path fixes 5d33c72 pass 76 native tests (1 skip). Actual system Share sheet proof cb396a5 passes 4 presentation cases and a separate real file Send with exact message and attachment bytes; adds named image/file previews. Physical/cloud-provider/Safari and multi-attachment behavior remain boundaries. Watch recovery 6aa033f passes paired startup recovery, inbox/thread navigation, 8 controlled load checks and 2 relay checks. Full phone-reboot reconnection is being investigated; reply/approval delivery and physical/background/complication behavior remain open. The earlier harness isolation incident and corrected staged rerun remain documented. |
| Q4 | Verification | VoiceOver, keyboard/focus and large Dynamic Type checked on representative desktop and native workflows; defects repaired. | Partial — desktop search verified 8190101; native large-text fixes 4af129e build and navigation pass. Small-text contrast fix 4838931 passes measured pixel checks; strict iOS 27 audit still retains 38 reports. Diagnostic evidence 322837b reproduces and localizes the unidentified Settings detection report to the upper Hosts area; its visible values/actions are present in the accessibility API, so no speculative UI fix or waiver was applied. Physical VoiceOver and native Reactions menu remain open. |
| Q5 | Verification | Launch/scrolling memory, CPU and battery-sensitive background activity measured with reproducible fixtures; identified regressions repaired. | Partial — isolated simulator launch averaged 2.742 seconds over 3 samples. Table evidence 15c20c7 covers 20 same-document navigation cycles after warmup: closed-view DOM/listeners/documents show no growth; heap rises 2.2%, which alone does not establish a leak. Board/Calendar rendering is bounded and measured; timings are shared-host observations. Native memory/scrolling measurement is underway. Hardware CPU/battery remains open. |
| Q6 | Verification | Large table/library and representative artifact import/preview formats exercised with bounded data and recorded limits. | Partial: grid fix cc3065e and evidence 6de9e62 mount 39 desktop/31 phone rows for 1,200/5,000 records; final-row keyboard edit and retained offscreen input pass. Imports/previews verified in 4b2164a: real CSV picker/download and HTML/Markdown/text/image/PDF desktop/390px. BOM fix a9056ad; corrupt-image/missing-file fixes 1a1981e. Board/Calendar source 1efc416/c2bc4da and live evidence 15c20c7 bound 5,000 records to 150 board cards, 280 distributed calendar cards or 10 on a dense day; row 5,000 remains reachable/editable and weeks no longer overlap. Full data still loads. Remote latency remains open; native artifact previews are under runtime review. |
| C1 | Compatibility | Historical channel transport envelopes remain visible in native ThreadChat; determine a supported solution without rewriting user history. | Open — stable SDK currently lacks a message transform/filter hook |
| I1 | Integration | Channel member editor has one scroll region and visible controls on desktop, 390px phone and 480px height. | Verified by owning thread: source 6e84e8f, evidence b358704, 115 Teams tests |
| I2 | Integration | Talk dictation returns to its originating companion and remains usable when a compact composer clips its inline controls. | Verified by owner: source f512edb and fb4ca80, live capture 06f6389 preserves exact draft/file and source on desktop/phone. |

Current ownership: native artifact reviewer owns artifact runtime verification;
native performance reviewer owns repeated navigation/scrolling measurements;
foundation reviewer investigates Watch reconnection after a phone restart.
The prior Share, Settings and Tables lanes are committed and their private
devices, browsers and fixtures are removed. The Settings audit remains unresolved.
Root owns this ledger, packed kit/consumer locks and integration.
Completed recovery, search, import and preview evidence is committed. Teams and
host companion work remain with their existing threads. Generated contracts
and packed kit/consumer locks are coordinated before writing.

Each closure will record the source commit, meaningful regression or live
evidence, and any narrower remaining boundary. New reproducible defects found
while verifying these items join the ledger; they do not disappear into a
summary of general limitations.

Follow-up integration evidence: Tasks current/earlier handoff and discussion
return retains exact reply/file DOM and phone controls (1c9d3d3); shared Chat
image quote retains crop, edited prompt and file after reload and resize
(1d78bb2). Real Task Hand off exposed a missing hostId (ed12a98); bot re-send exposed
label-based duplicate handoffs (6bec6a4). Both are fixed and verified live in
ba0ae10, including exact retained draft/file and two bot responses sharing one
conversation. Other native workbench entry points remain under its owner's audit.

Latest full JavaScript checkpoint passed 1,581 tests and all 18 package
typechecks, compatibility, docs, marketplace, contracts and kit checks. Native
combined checkpoint ran 76 tests with 1 skip and zero failures, including Page
recovery, representative serialized payload parity and five real Share input tests. These results
are bounded checkpoints, not a claim that all open QA has passed.
