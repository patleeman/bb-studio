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

## The Bot (formerly the Chief of Staff)

The personal project's (`proj_personal`) lead is the user's Bot
(`packages/bb-studio/src/bot.ts`). The `bots` table gives it a name, an
emoji avatar and a state (`active`, `paused`, `stopped`); its thread is
always the personal project's lead, so a handoff rotates it and the
project's Heartbeat is the Bot's check-in, with a prompt that uses its
name. The Bot sees every project in `studio_list_items`. Setup → Project
leads doesn't list the personal project; it links to the Bot's home.

Each Bot has one Memory page (a Studio page; its `## Check-in` section is
the check-in list) and its own skills, which only its thread loads until
the user shares one into BB's user skills. Its check-in prompt points at
the page and asks it to stay silent unless something matters. Its
instructions come from `agents.configure` for its thread; a new Bot's
thread is spawned with `pluginMetadata: { bot }` so its first turn gets
them before it becomes the lead.

A migration made an existing Chief of Staff the Bot, named "Chief of
Staff", with the same thread and Heartbeat. `chief_of_staff`,
`chief_of_staff_set` and `chief_of_staff_set_run` are deprecated aliases of
`bot_get`, `bot_set_thread` and `bot_set_run` for one release. See the
Studio README's **Bot** section for its workspace (sidebar, Info and
Threads tabs), pause and stop.

### Runners

A Bot hands recurring work to runners (`packages/bb-studio/src/runners.ts`,
table `bot_runners`): long-lived threads, each woken by its own automation
(the Heartbeat's cadences, via `heartbeatCron`), that report only through
`runner_report` (`log`, `tell`, `urgent`). Runner threads have no
`parentThreadId` or `lifecycleOwnerThreadId`: BB posts child-completed and
ownership notices to a thread's parent, and a lifecycle owner would archive
them on a handoff. Studio's table is the source of truth for which Bot owns
them. A thread the Bot started that an automation already wakes can be
adopted from the Bot's Info tab; it keeps its automation. See the Studio
README's **Bot → Runners**.

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
