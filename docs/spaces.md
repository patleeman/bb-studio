# Spaces

A Space is an area of work: its threads and its Studio items. Items follow
their project; a Space holds whole projects and threads added one by one.
One Space, Personal, is the default and can't be deleted. Making a Space makes
only its catch-all folder under `~/Spaces`; there is no Space page and no
lead until the user picks one. A page made for a Space is an ordinary page.

Code: `packages/bb-studio/src/spaces.ts` (Spaces and members),
`src/space-threads.ts` (one Space per thread), `src/space-lead.ts` (lead,
heartbeat, handoff), `src/ui/ManageSpace.tsx` and `src/ui/SpaceHeartbeat.tsx`
(the dialogs).

## One Space per thread

A thread is in exactly one Space: the one it was added to (`space_threads`),
otherwise the one that owns its project (`space_projects`), otherwise
Personal, the top level. Adding a thread to a Space moves it there.

## The lead and its Heartbeat

The lead is optional and is just one of the Space's threads. Making a thread
the lead adds it to the Space if it isn't there. The Heartbeat wakes the lead
on a schedule (every 5, 15 or 30 minutes, hourly, every 2 or 6 hours, daily,
weekdays, weekly, or a custom cron) through an automation named
`Studio space heartbeat <spaceId>`. It needs a lead: clearing the lead, or
the lead thread being deleted, turns it off. Handing the lead off to a new
thread keeps the successor the lead and moves the Heartbeat to it.

## The top level and the Chief of Staff

The default Space (Personal) is the top level: everything lives there until
it's filed into a Space. Every level can have a lead, and the top level's
lead is the Chief of Staff. Workers live with whoever started them, so the
Chief of Staff's workers sit at the top level too.

The slot starts empty. Making a thread the Chief of Staff makes it the
default Space's lead (`space_set_lead` on that Space, or `chief_of_staff_set`)
and adds it to the default Space if it was elsewhere. The Chief of Staff
sees every Space by default, and it can't also lead another Space: if it led
one, that Space loses its lead and its Heartbeat turns off, and the Chief of
Staff's Heartbeat starts from that schedule when it had none. Its Heartbeat
is the default Space's (`Studio space heartbeat <spaceId>`) with the Chief of
Staff's prompt. Removing it leaves the thread an ordinary top-level thread. A
handoff keeps the successor Chief of Staff, and deleting the thread empties
the slot. Archiving it doesn't: like any lead, Studio keeps an archived Chief
of Staff and its Heartbeat, and Studio Sidebar won't archive it until it's
removed. Its row menu has Heartbeat… to set the schedule.

Studio used to keep the Chief of Staff in its own slot above every Space. A
migration moves it into the default Space's lead (it wins over an older
Personal lead, which stays a thread), adds the thread to the default Space,
and moves its Heartbeat settings there. At startup Studio deletes the old
`Studio chief of staff heartbeat` automation and provisions the Space one if
the Heartbeat was on.

Other plugins (Studio Sidebar) open Studio's Space dialogs by window event:

- `studio:new-space` (no detail): New Space.
- `studio:space-dialog` with detail `{ spaceId, dialog }`, where dialog is
  `edit`, `delete`, `threads`, `projects` or `heartbeat` (lead and
  Heartbeat). Studio cancels the event when it opens one.
- `studio:chief-dialog` (no detail): the Chief of Staff's Heartbeat, saved
  with `chief_of_staff_set_run`. Studio cancels the event when it opens it.
- Studio sends `studio:space-changed` with `{ spaceId }` after a dialog
  changes a Space.

## RPCs (Studio contract)

- `space_lead({ spaceId })` → `{ spaceId, name, icon, color, leadThreadId,
  defaultProjectId, run }`.
- `space_set_lead({ spaceId, threadId })` makes an existing thread the lead,
  or clears it with `null`. Same output as `space_lead`.
- `space_set_run({ spaceId, enabled, cadence, time?, cron? })` sets the
  Heartbeat; turning it on needs a lead.
- `space_of_threads({})` → `{ threads: Record<threadId, spaceId> }`.
- `createInSpace({ id, pluginId, kind })` → `{ href, title }`: a Studio item in
  the Space's folder.
- `thread_handoff({ threadId, request })` → `{ threadId }`: continues a thread
  on another provider; a lead's successor becomes the lead, including the
  Chief of Staff's.
- `chief_of_staff({})` → `{ threadId, originSpaceId, run }`: the default
  Space's lead and Heartbeat. `originSpaceId` is deprecated and always null.
- `chief_of_staff_set({ threadId })` makes a thread the default Space's lead,
  or clears it with `null`. Same output as `chief_of_staff`.
- `chief_of_staff_set_run({ enabled, cadence, time?, cron? })` sets the
  default Space's Heartbeat; turning it on needs a Chief of Staff.

Deleting a Space turns its Heartbeat off and forgets its lead. If the
Heartbeat can't be turned off, the Space stays and the delete fails.
