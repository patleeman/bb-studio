# Native page drafts

Page editing and Work with this page store user text under the App Group's
`PageDrafts/<SHA256 of server URL>/` directory. Each atomic JSON file identifies
its server, page and draft kind. Text changes write immediately, before the
1.2-second server autosave delay. The Pages list exposes local drafts even when
the server no longer lists their page. Derived page caches remain separate.

The editor retains the exact ID-bearing Markdown used as the server's
`editDocument.expected` value. Reading a newer page never rebases dirty text.
A conflict leaves the draft intact and offers View server, Copy local text,
Retry, and a confirmed discard/reload. A deleted or offline page still permits
local recovery. There is deliberately no recovered-page creation action:
Pages.create has no idempotency key, so a lost response could create duplicates.

Before sending an edit, the draft records the submitted text. If the process
ends before the response, reopening compares the server against the original
base and submitted text. An unchanged base permits a guarded save. A server
matching the submitted content recognizes the lost acknowledgement and retains
any later typing. Any other version requires explicit conflict recovery.
An acknowledgement only clears a draft if no newer typing remains.

Write failures keep the previous atomic file, expose an error and stop server
saving. The editor blocks normal dismissal until local persistence succeeds or
the user explicitly discards. Copy exports the current in-memory text; Export
stored draft preserves the last durable file, including an unreadable file.
Work prompts expose local save errors and export/copy/discard controls too.
They retain follow-up typing received while a thread start is in flight.

Tests exercise disk-backed model restart, server namespaces with cloned IDs,
newer-server conflicts, delayed acknowledgements, lost acknowledgements,
injected disk-full failure, missing pages, corrupted files, and work prompts.
Simulator tests do not establish physical-device force-quit, power-loss,
App Group protection/locked-device behavior, or keyboard accessibility quality.
Atomic writes protect against partial replacement, not every hardware failure.
