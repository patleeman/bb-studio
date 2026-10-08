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
Personal. Adding a thread to a Space moves it there.

## The lead and its Heartbeat

The lead is optional and is just one of the Space's threads. Making a thread
the lead adds it to the Space if it isn't there. The Heartbeat wakes the lead
on a schedule (every 5, 15 or 30 minutes, hourly, every 2 or 6 hours, daily,
weekdays, weekly, or a custom cron) through an automation named
`Studio space heartbeat <spaceId>`. It needs a lead: clearing the lead, or
the lead thread being deleted, turns it off. Handing the lead off to a new
thread keeps the successor the lead and moves the Heartbeat to it.

## The Chief of Staff

The Chief of Staff is one thread above every Space. The slot starts empty.
Any thread from any Space can be promoted. Promoting it takes it out of its
Space, so `space_of_threads` leaves it out and every Space's sidebar pins it
at the top. If it led a Space, that Space loses its lead and its Heartbeat
turns off. The Chief of Staff's own Heartbeat, an automation named
`Studio chief of staff heartbeat`, starts from that schedule. It can't also
be a Space's lead. Demoting it, or promoting another thread, returns it to
the Space it came from, or to Personal if that Space is gone. A handoff
keeps the successor Chief of Staff, and deleting the thread empties the slot.


Other plugins (Studio Sidebar) open Studio's Space dialogs by window event:

- `studio:new-space` (no detail): New Space.
- `studio:space-dialog` with detail `{ spaceId, dialog }`, where dialog is
  `edit`, `delete`, `threads`, `projects` or `heartbeat` (lead and
  Heartbeat). Studio cancels the event when it opens one.
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
  on another provider; a lead's successor becomes the lead, and the
  Chief of Staff's successor becomes Chief of Staff.
- `chief_of_staff({})` → `{ threadId, originSpaceId, run }`.
- `chief_of_staff_set({ threadId })` promotes a thread, or demotes the current
  one with `null`. Same output as `chief_of_staff`.
- `chief_of_staff_set_run({ enabled, cadence, time?, cron? })` sets its
  Heartbeat; turning it on needs a Chief of Staff.

Deleting a Space turns its Heartbeat off and forgets its lead. If the
Heartbeat can't be turned off, the Space stays and the delete fails.
