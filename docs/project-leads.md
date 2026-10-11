# Project leads

A BB project can have a lead: one thread that a Heartbeat wakes on a
schedule. Leads and Heartbeats are set in Studio's Setup page, under
**Project leads**. Studio used to group work into Spaces; BB projects
replace them.

Code: `packages/bb-studio/src/project-lead.ts` (leads, Heartbeats, handoff,
migration) and `src/ui/ProjectLeads.tsx` (the Setup section).

## The lead and its Heartbeat

The lead is optional. A thread leads at most one project: making it lead
another moves it, the old project loses its lead and Heartbeat, and the
schedule carries over if the new project has none. The Heartbeat wakes the
lead on a schedule (every 5, 15 or 30 minutes, hourly, every 2 or 6 hours,
daily, weekdays, weekly, or a custom cron) through an automation named
`Studio project heartbeat <projectId>`. It needs a lead: clearing the lead,
or the lead thread being deleted, turns it off. Handing the lead off to a
new thread (`thread_handoff`) keeps the successor the lead.

## The Chief of Staff

The personal project's (`proj_personal`) lead is the Chief of Staff.
`chief_of_staff`, `chief_of_staff_set` and `chief_of_staff_set_run` act on
that lead. The Chief of Staff sees every project in `studio_list_items`.

## RPCs

- `project_leads`: every lead and its Heartbeat settings.
- `project_lead({ projectId })`: one project's lead.
- `project_set_lead({ projectId, threadId | null })`: set or clear it.
- `project_set_run({ projectId, enabled, cadence, time?, cron? })`: the
  Heartbeat.

## Migration from Spaces

Each Space's lead and Heartbeat moved to the Space's main project: the
default Space (Personal) to `proj_personal`; otherwise the project the lead
thread is in; else the Space's default project if it isn't its `~/Spaces`
catch-all; else its first other project; else the catch-all. A project that
already got a lead keeps it (the newest lead wins). Old Heartbeat
automations are deleted, and enabled Heartbeats are provisioned again at
startup. Existing `~/Spaces` folders are left alone, and the Space tables
stay in the database, unused.
