# Space leads

A Space is the meta-project. Each Space can have one lead thread. Opening a
Space shows the lead's chat with the Space page beside it. The Space page (the
Space's existing home page from `src/space-page.ts`) is the lead's brief, plan,
decisions and memory. Studio does not make a second page for the lead.

Code: `packages/bb-studio/src/space-lead.ts` (leads, heartbeat, handoff,
overview) and `packages/bb-studio/src/space-threads.ts` (one Space per thread).

## One Space per thread

A thread is in exactly one Space:

- If the thread was added to a Space (`space_threads`, keyed by thread id), it
  is in that Space.
- Otherwise it is in the Space that owns its BB project (`space_projects`).
  Projects with no owner fall back to the default (Personal) Space.

Adding a thread to a Space moves it there. An explicit membership overrides the
project's Space. Removing it puts the thread back in its project's Space.
`spaceMembers` and the `studio_space_items` agent tool accept
`bb-thread:<id>` members (the tool also takes `threads: [id]`). Pages and other
items still follow their project, as before.

Migration `space-thread-owner-v1` (in `office_migrations`) runs once after
`space-root-v1`. It moves the thread rows that `space-root-v1` kept as tags
(`item_tags` rows with plugin `bb-thread` under a Space id) into
`space_threads`. A thread that was in several Spaces keeps the one it joined
last (newest `created_at`, ties by Space id). Each dropped membership is logged
as a warning. Empty leftover Space tags are deleted.

## RPCs (Studio contract)

`SpaceLead` is `{ spaceId, name, icon, color, leadThreadId, pageId, pageHref,
defaultProjectId, run }`. `run` is null or `{ enabled, cadence: "hourly" |
"daily" | "weekdays", time: "HH:MM" }`. `request` is the full
`NewThreadRequest` from `experimental_NewThreadComposer`; Studio replaces its
`projectId`.

- `space_lead({ spaceId })` → `SpaceLead`. Clears a lead whose thread was
  deleted (404 or `deletedAt`). Transport errors keep it.
- `space_lead_setup({ spaceId, request })` → `SpaceLead`. Makes sure the Space
  page exists, then spawns the lead if there is none, in the Space's default
  project, else Personal. The lead gets agent-only instructions; the visible
  chat starts with the user's input. Thread plugin metadata is
  `{ role: "space-lead", spaceId, pageId }`. The lead is added to the Space.
  Calls are serialized per Space and idempotent; a deleted lead is recreated.
- `space_thread_start({ spaceId, request })` → `{ threadId }`. Spawns in the
  default project (else Personal) and adds the thread to the Space.
- `space_overview({ spaceId })` → `{ threads: [{ id, title, status, updatedAt,
  parentThreadId, isLead }], items: [{ ref, title, kind, href, icon,
  updatedAt }] }`, newest first. Threads are those added to the Space plus the
  open threads of its projects, minus archived threads and threads added to
  another Space. Items are the Space's unarchived items (`ref` is
  `<plugin>:<id>`), without the Space page and background kinds.
- `space_of_threads({})` → `{ threads: Record<threadId, spaceId> }` for every
  open thread and every explicitly added thread. The result is cached until a
  membership or project ownership changes, a thread is created, archived,
  unarchived or deleted, or 60 seconds pass. Every such change publishes
  Studio's realtime channel (`studio-changed`); sidebars refetch then.
- `space_set_run({ spaceId, enabled, cadence, time? })` → `SpaceLead`. Needs a
  lead to enable. Time defaults to the previous time or 09:00 (server time
  zone); hourly uses its minute. Automations owns the schedule. Studio keeps an
  automation named `Studio space heartbeat <spaceId>` that wakes the lead with
  a heartbeat prompt. It is found by name, so a lost create response is safe.
  Disabling deletes the automation and keeps the settings.
- `thread_handoff({ threadId, request })` → `{ threadId }`. Spawns on the
  chosen provider in the old thread's project, with an agent-only excerpt of
  the latest response, a link to the old thread and the Space page. A lead's
  successor becomes the lead (metadata, `space_leads`, heartbeat target). A
  thread added to a Space keeps that Space. The old thread is archived. A
  successor record (`space_thread_handoffs`) makes retries return the same
  thread.

Deleting a Space turns its heartbeat off and forgets its lead.

## Lead instructions

The lead is told to read and keep the Space page current, to start workers
with `bb thread spawn` in the Space's project and add them with
`studio_space_items`, to steer them with `bb thread tell`, and to report
through the Studio Feed (`feed_post`), which reaches the Inbox.
