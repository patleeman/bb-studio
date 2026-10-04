# Project hubs

Every BB project has an on-demand page and lead. Personal is the Chief of Staff:
its role is `chief-of-staff`, its display name is `Chief of Staff`, and its page
has What I watch, Handed off, and Memory. Other projects have role `project` and
pages with Brief, Plan, Decisions, Memory, and Links.

## RPCs

The project shape is `{ projectId, name, role, leadThreadId, pageId, pageHref,
run }`. The three reference fields are nullable. `run` is null or
`{ enabled, cadence: "hourly" | "daily" | "weekdays", time: "HH:MM" }`.

- `project_get({ projectId })` returns the project shape and clears confirmed
  deleted references. Transport errors preserve references.
- `project_setup({ projectId, request })` returns the shape. The native composer
  request is the same as `office_start`. Setup creates only missing objects,
  preserves attachments and execution settings, and overrides request.projectId
  with the hub's project. The user's text supplies Brief (What I watch for CoS).
- `project_threads({ projectId })` returns `{ threads: [{ id, title, status,
  updatedAt, isLead }] }`. Title may be null. BB's default thread visibility
  applies; top-level threads are paginated and sorted newest first by updatedAt.
- `project_set_run({ projectId, enabled, cadence, time? })` returns the shape.
  Time defaults to 09:00 in the server's local timezone. Hourly uses its minute.
  A lead must exist. Disabling deletes the heartbeat automation and retains the
  disabled cadence in Studio.
- `thread_handoff({ threadId, request })` returns `{ threadId }` for the successor.
  Request is the full composer request, optionally extended with `prompt` for a
  note. Its input and attachments are preserved, even when its text is empty.
- `bots_overview({})` returns `{ bots: [{ id, name, avatar, providerId, projectId,
  mission, hasMemory, schedules, suggestion }] }`. Suggestion is `retire` for
  retired bots, `chief-of-staff` for an exact Chief of Staff name or
  `chief-of-staff` handle, otherwise `project`. Schedules counts stored agent
  automations targeting profile threads plus an enabled interval heartbeat.
- `bot_to_project({ botId, projectId? })` returns the shape. Without a target it
  creates a named BB project using the bot's existing home directory and host.
  Chief of Staff bots always merge into Personal. `bot_retire({ botId })` returns
  `{ ok: true }` and uses the bot runtime's retirement operation, retaining history.

## Instructions and handoff

Lead instructions use the SDK's `visibility: "agent-only"` input part; the visible
chat starts with the user's text. They establish shared project memory, worker
coordination, and Inbox reporting. Chief of Staff also creates projects, calls
project_setup to staff them, and sends work to project leads.

The SDK fork request cannot select a provider. Handoff therefore spawns in the
old thread's project with the requested execution settings, an agent-only excerpt
of its latest response (up to 12,000 characters), an old-thread link, and the
project page/Memory pointer. The excerpt is context, not a generated summary of
the full conversation; the successor is told to read more history if needed.
The lead mapping and heartbeat target move before archiving the old thread. A
saved successor allows retries to finish archive/schedule operations without
spawning another thread. This action creates no new project page.

## Bot migration and scheduling

Bot mission and memory are imported without overwriting existing page content.
Existing pages receive marked Brief/Memory sections using Pages' optimistic
editDocument RPC. Existing leads are preserved; otherwise the bot's existing DM
is adopted and detached from its bot profile. No DM means no lead is spawned.

The SDK has no thread-move API. Adopted DMs stay in their original BB project,
with the destination hub pointing to them. They are not included in the new
project's top-level thread listing. Their heartbeat belongs to their original
project, which owns the execution target. Bot histories and original files stay.

One project heartbeat replaces active bot schedules. The first active cron
supplies a supported cadence/time (weekday cron remains weekdays); otherwise an
interval of at most an hour becomes hourly, and other intervals become daily.
Unsupported cron shapes fall back to daily at 09:00. Original automations are
paused, not deleted, and the old bot interval is disabled. With no DM the cadence
is retained pending lead setup. Existing enabled Run configuration wins on merge.

Automations owns timing; Studio stores configuration and automation identity.
Creation starts disabled and is reconciled by a stable name before enablement.
Retries can recover a lost creation response. Setup and mutations serialize per
hub in the running service. SQLite and external calls cannot share a transaction:
a crash between external page/thread/project creation and saving its ID can leave
an unlinked object. Migration markers avoid reimporting unchanged documents.

## Inbox links

At source and read time, removed Office and channel routes resolve to the event's
thread, else item, else `/plugins/studio/projects/<projectId>`, else null. Existing
valid links, including the Inbox panel itself, remain intact. Stored legacy
attention events receive the same mapping without rewriting history.
