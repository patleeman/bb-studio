# Spaces and their leads

A Space is an area of work: its threads, its Studio items (through its
projects), and a lead thread that keeps it on track. One Space, Personal, is
the default and can't be deleted.

Code: `packages/bb-studio/src/space-lead.ts` (leads, heartbeat, handoff,
overview), `src/space-threads.ts` (one Space per thread), `src/space-page.ts`
(the brief) and `src/ui/space/` (the views).

## Opening a Space

A Space opens on its lead's thread page: BB's own title bar and chat on the
left, the Space's tabs in the workbench on the right. A Space without a lead
opens a page that starts one.

- **Status** (opened beside the lead once per session): what needs you, what
  is working and its latest progress, the Space's Studio items, recent
  activity and idle threads. Each thread says whether the lead or you steer it.
  Built from the threads' own events, so it stays true when the lead is busy.
- **Space thread**: any thread of the Space, as its own tab, so the lead stays
  in the chat.
- **New in Space**: makes a Studio item in the Space's folder; the tab becomes
  the item.
- **Space page**: the brief.

The lead's thread header holds the Heartbeat and the Space menu. In the
sidebar (Studio Sidebar's By space), each Space lists its Studio items and its
threads, each with its own +; the lead isn't listed, since the Space's heading
opens it. Other plugins open an item or thread beside the lead through
`src/ui/space/open-in-space.ts`.

## The brief

The Space page is an ordinary Pages page that starts as the Space's purpose,
a Plan section and a Decisions section. The lead keeps it current; every
thread in the Space reads it first. Live status is the Status tab, not the
page.

## The lead

The lead steers the workers it starts (`bb thread spawn` in the Space's
project, added with `studio_space_items`). Threads you start in the Space are
yours: the lead reads them to keep the brief and its reports current, but
doesn't steer them unless you ask. It reports through the Studio Feed, which
reaches your Inbox. The Heartbeat wakes it on a schedule (every 5, 15 or 30
minutes, hourly, every 2 or 6 hours, daily, weekdays, weekly, or a custom
interval) through an automation named `Studio space heartbeat <spaceId>`.

## One Space per thread

A thread is in exactly one Space: the one it was added to (`space_threads`),
otherwise the one that owns its project (`space_projects`), otherwise
Personal. Adding a thread to a Space moves it there. Studio items follow
their project.

## RPCs (Studio contract)

- `space_lead({ spaceId })` → `{ spaceId, name, icon, color, leadThreadId,
  pageId, pageHref, defaultProjectId, run }`.
- `space_lead_setup({ spaceId, request })` starts the lead from BB's composer
  request (Studio sets the project) and makes sure the page exists.
- `space_thread_start({ spaceId, request })` → `{ threadId }`: a thread you
  start, in the Space.
- `space_overview({ spaceId })` → `{ threads, activity, items }`: each thread
  with its latest progress and any failure or blocker, recent activity, and
  the Space's items. What the Status tab shows.
- `space_of_threads({})` → `{ threads: Record<threadId, spaceId> }`.
- `space_set_run({ spaceId, enabled, cadence, time?, cron? })` sets the
  Heartbeat.
- `createInSpace({ id, pluginId, kind })` → `{ href, title }`: a Studio item in
  the Space's folder.
- `thread_handoff({ threadId, request })` → `{ threadId }`: continues a thread
  on another provider; a lead's successor becomes the lead.
- `spaceWidget({ id })`: the Space's items, threads and projects, for the iOS
  app's Space screen.

Deleting a Space turns its Heartbeat off and forgets its lead.
