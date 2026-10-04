# Studio projects

Studio owns projects independently of BB projects. A project needs no folder or
repository. It may connect to one non-Personal BB project through `bbProjectId`.
Chief of Staff is one special Studio project, independent of BB Personal.

## Shape and RPCs

`StudioProject` is `{ id, projectId, name, icon, position, archivedAt, bbProjectId,
role, leadThreadId, pageId, pageHref, run }`. IDs start with `sp_`; `projectId` is
an alias of `id` for existing clients. Icon, archive time, connection, lead and
page fields are nullable. Role is `project` or `chief-of-staff`. Run is null or
`{ enabled, cadence: "hourly" | "daily" | "weekdays", time: "HH:MM" }`.

- `projects_list({})` returns `{ projects: StudioProject[] }` in position order,
  including archived projects. Clients can filter on archivedAt.
- `project_get({ projectId })` returns StudioProject, clearing confirmed deleted
  lead/page references. Transport errors preserve references.
- `project_create({ name, bbProjectId? })` returns StudioProject without starting
  a lead or creating a page. It never creates folders or changes BB projects.
- `project_update({ projectId, name?, bbProjectId?, icon? })` returns StudioProject.
  Null disconnects the BB project or clears the icon. A BB project has at most
  one Studio connection, so implicit membership has one owner. Connecting
  Personal is rejected: projects without connections already execute there.
- `project_reorder({ projectId, previousProjectId, nextProjectId })` returns
  `{ ok: true }`. Neighbors are nullable; stale/nonadjacent neighbors fail.
- `project_archive({ projectId, archived })` returns StudioProject. Archive
  disables its heartbeat, retaining its page, threads, membership and files.
  Restore leaves Run disabled. Chief of Staff cannot be archived.
- `project_setup({ projectId, request })` returns StudioProject, creating only
  the missing lead/page. Request is the native composer request from office_start.
- `project_thread_start({ projectId, request })` returns `{ threadId }` for a new worker.
  Setup and start spawn in the connected BB project, otherwise Personal, then
  explicitly link the new thread. Archived projects must be restored first.
- `project_threads({ projectId })` returns `{ threads: [{ id, title, status,
  updatedAt, linked, isLead }] }`, sorted newest first. Title may be null.
  Implicit members are top-level threads; explicitly linked children are included.
- `project_link({ projectId, refs })` and `project_unlink({ refs })` return
  `{ ok: true }`. References are `thread:<id>` or `item:<pluginId>:<itemId>`.
- `project_membership({})` returns `{ threads: Record<threadId, studioProjectId>,
  items: [{ ref, projectId, title, kind, href, icon }] }`.

## Membership and Library

Each ref has one explicit owner. Linking elsewhere moves it atomically, without
changing the underlying thread or item. Every thread in a connected BB project
belongs implicitly unless an explicit owner overrides it. Unlink records an
exclusion so an implicit member really becomes a one-off. Relinking clears the
exclusion. Linking to Chief of Staff is ordinary membership, not an unlink.
Archived Studio projects retain stored links, but their members are omitted from
project_membership, so they appear as one-offs or Library items. Restore
reactivates the links. An archived explicit owner suppresses implicit ownership
in another connected project too. BB's default thread archive filter
applies to implicit membership; explicit links persist until unlinked.

Membership reads use one paginated BB thread list and local item metadata,
without provider fan-out. Item titles/icons are snapshots taken when linked;
relinking refreshes them. Linking validates targets before committing the batch.
Mutations publish Studio realtime. Lead preambles and heartbeat prompts list
member titles/refs. Dynamic lead instructions include explicit membership on the
next runtime resolution; live sessions are not interrupted. Instructions tell
agents to read project_membership for current ownership.

Pages can remain standalone: Pages create accepts `projectId: null` and
`parentId: null`, stores null, and lists the page in the Library. A child page
inherits its parent's project. Creating a Studio project page uses its optional
BB connection or null, then links the page explicitly. Linking any existing
page/item does not change its stored project or remove it from the Library.

## Migration

On first use, each existing non-Personal BB project gets a deterministic Studio
ID and connection. Existing office_projects lead/page references, Run settings,
bot-import mappings and handoff mappings move to that ID. Existing leads/pages
also receive explicit membership. Existing Chief of Staff moves to the special
Studio project; its BB connection remains null. The transaction has a durable
completion marker, so restart does not recreate projects or overwrite edits.
BB projects created later need an explicit Studio connection.

Legacy BB IDs resolve through migration aliases only. Responses always return
Studio IDs. These aliases keep old Inbox/project URLs usable during transition.
No BB project, thread, page, directory or history is deleted by migration.

## Run mode, handoff and bots

`project_set_run({ projectId, enabled, cadence, time? })` returns StudioProject.
Time defaults to 09:00 in the server timezone; hourly uses its minute. Disabling
removes the automation and retains the disabled setting. Automations owns timing;
Studio stores identity/configuration. Creation starts disabled and reconciles by
stable name, so a lost creation response can be retried.

`thread_handoff({ threadId, request })` returns `{ threadId }`. Request is the
full composer request, optionally extended with `prompt` for a note. The SDK
fork API cannot change providers, so it spawns in the old thread's BB project,
with an agent-only latest-response excerpt, old-thread link, and the owning
Studio project's page/Memory pointer. It links the successor to that Studio
project, moves any lead mapping and heartbeat, then archives the old thread.
A durable successor record makes retries safe after partial failure.

Lead and Chief-of-Staff preambles use `visibility: "agent-only"`; the visible
chat begins with the user's input. They establish shared memory, worker
coordination and Inbox reporting. CoS also creates and staffs Studio projects.

`bots_overview({})` returns `{ bots: [{ id, name, avatar, providerId, projectId,
mission, hasMemory, schedules, suggestion }] }`. Project IDs are Studio IDs or
null. `bot_to_project({ botId, projectId? })` returns StudioProject. With no target,
it creates a Studio project connected to the bot's BB project, or reuses the
existing Studio connection. Personal bots get an unconnected Studio project.
Chief-of-Staff bots always merge into the special Studio project.

Mission and memory merge through Pages' optimistic editDocument RPC without
replacing existing content. Existing leads win; otherwise the DM is adopted and
explicitly linked, retaining its original BB project. No DM means no spawned
lead. Active bot schedules consolidate to one project heartbeat; originals are
paused, and the bot interval is disabled. Without a lead the cadence stays
pending until setup. Supported cron times are preserved; unsupported shapes
become daily at 09:00. `bot_retire({ botId })` returns `{ ok: true }`, preserving
history through the bot runtime's retirement operation.

SQLite and external creation cannot share a transaction. A crash between
creating a page/thread and recording its ID can leave an unlinked object;
completed IDs and migration markers make normal retries idempotent.
