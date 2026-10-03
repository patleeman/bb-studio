# Studio review issue ledger

This ledger tracks the remaining work from the [2 October review](codebase-review-2026-10-02.md).
The repair goal is active. A passing unit test does not close a required live
check; an unavailable device or SDK capability remains an explicit open item.
Completed first-pass fixes and their evidence remain in the review report.

| ID | Type | Issue and acceptance criterion | Status / owner |
| --- | --- | --- | --- |
| M1 | Defect | Server switching isolates native caches, drafts, widget/share state and captured in-flight writes; unknown legacy drafts remain recoverable without guessing their origin. | Storage/extension isolation pushed as be29216: 39 tests (1 skip), app/extensions/watch build. In-flight action audit remains open. |
| M1b | Defect | Multi-step native actions keep one server client after awaits; completions from the previous server never navigate the new server to a matching ID. NewThread, PageWork, StudioChat and quick-create followups identified during review. | Open — native followup |
| M2 | Recovery | Restart/force-quit recovery finds native audio left between capture and committed enqueue, preserves its origin and prevents false completion. | Open |
| M3 | Recovery | Unsaved native Page edits survive view destruction/restart with explicit conflict/retry behavior. | Open |
| D1 | Recovery | Unsaved Draw edits survive reload/crash and recover without overwriting newer server content. | Open |
| T1 | Recovery | Browser Talk crash/quota recovery preserves durable chunks, reports unrecoverable storage failures honestly, and offers download before close. | Open — coordinate after Talk owner completes return flow |
| S1 | SDK | Shared provider results distinguish absent data, partial snapshots and unavailable providers; picker and hub retain independent storage policies. | Pushed as 1c0a2d6; picker/hub outage, partial, uninstall and recovery tests pass. |
| S2 | SDK | Search retries only affected providers in coalesced background work; interactive searches do not wait for whole-suite repair; freshness is visible. | In progress — foundation reviewer |
| S3 | SDK | Reusable provider tests cover read/list/get, change IDs, deletion, truncation, offline state and optional Studio installation across providers. | In progress — foundation reviewer, first shared fixtures |
| S4 | SDK | Canonical item/mention references are shared, extensible and compatible with older links and opaque IDs. | Open |
| S5 | SDK | Host-dependent UI code is isolated in cleanup-safe adapters using available public capabilities, with a stable-host regression loop. | In progress — root, Reactions first |
| S6 | SDK | Native handwritten plugin endpoints are inventoried and covered by generated contracts or parity tests, including Feed. | Open |
| P1 | Product | Explicit Explore → Task action preserves source/project/space, is idempotent and supports Tasks being absent. | Pushed as 3318221; 71 Explore and 56 Tasks tests pass. Actual space inheritance and optional-plugin live checks running. |
| P2 | Product | Feed search, unread/date filters and reader-position restoration work across discussions and reloads. | Open |
| P3 | Product | Tables agent query can traverse more than 100 rows predictably and reports pagination/total state. | In progress — root; pagination and revision checks implemented, focused tests pass. |
| P4 | Product | Reactions has one configuration editor and honest saved/applied/error states; applying cannot strand a disabled plugin. | Pushed as d0cba3d; 38 tests, types/build pass. Stable-host live verification running. |
| Q1 | Verification | Device audio interruption/background/low-storage and server-switch delivery have recorded results against isolated fixtures. | Open — inventory device capabilities first |
| Q2 | Verification | Real APNs delivery, exact approval action, stale-action rejection and clear behavior verified without touching user work. | Open — needs dedicated device/relay fixture |
| Q3 | Verification | Share extension and Watch pairing/transport exercised; destinations and snapshots remain server-scoped. | Open |
| Q4 | Verification | VoiceOver, keyboard/focus and large Dynamic Type checked on representative desktop and native workflows; defects repaired. | Open |
| Q5 | Verification | Launch/scrolling memory, CPU and battery-sensitive background activity measured with reproducible fixtures; identified regressions repaired. | Open |
| Q6 | Verification | Large table/library and representative artifact import/preview formats exercised with bounded data and recorded limits. | Open |
| C1 | Compatibility | Historical channel transport envelopes remain visible in native ThreadChat; determine a supported solution without rewriting user history. | Open — stable SDK currently lacks a message transform/filter hook |
| I1 | Integration | Channel member editor has one scroll region and visible controls on desktop, 390px phone and 480px height. | Verified by owning thread: source 6e84e8f, evidence b358704, 115 Teams tests |
| I2 | Integration | Talk dictation returns to its originating companion and remains usable when a compact composer clips its inline controls. | Verified by owner: source f512edb and fb4ca80, live capture 06f6389 preserves exact draft/file and source on desktop/phone. |

Current first-checkpoint ownership: the mobile reviewer owns native iOS; the
foundation reviewer owns kit server helpers and Studio hub/search; the product
reviewer owns Explore plus any coordinated Tasks endpoint; root owns this
ledger and Reactions. Teams remains with its existing threads. Browser Talk source is free; its
return-flow evidence is committed. Native action races remain open after the
storage isolation checkpoint. Generated files and dependency locks are coordinated before editing.

Each closure will record the source commit, meaningful regression or live
evidence, and any narrower remaining boundary. New reproducible defects found
while verifying these items join the ledger; they do not disappear into a
summary of general limitations.

Follow-up integration evidence: Tasks current/earlier handoff and discussion
return retains exact reply/file DOM and phone controls (1c9d3d3); shared Chat
image quote retains crop, edited prompt and file after reload and resize
(1d78bb2). Initial task creation/bot dispatch and other workbench entry points
remain under the existing workbench owner’s active audit.
