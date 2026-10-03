# Studio Tasks (plan)

**Studio Tasks** is a Studio add-on for the work around your threads: things
to do, who's doing them, and where they stand. A task can be yours, or you
can hand it to an agent. Handing it over starts a thread, and the task then
moves across the board as that thread runs, stops for you, and finishes.

Plugin id `studio-tasks` (see As built), display name "Studio Tasks", kind `task`.

## Where it fits

Several things in BB already look like tasks. Tasks covers the work
*between* threads, which none of them do:

| Feature | What it tracks | How Tasks relates |
|---|---|---|
| BB plan steps and pending todos | An agent's steps within one turn or thread | Unchanged. A handed-off task's thread may have a plan, but the task is the outer "why" |
| Agent Checklists | An agent's checklist within one thread | Same. Checklists are inside a thread, and tasks are outside it |
| GTD Sidebar | Threads sorted by who acts next | Threads only. A task can exist before any thread does, or have no thread at all |
| Automation Calendar | Scheduled, recurring runs | Tasks aren't scheduled runs. A due date is a deadline, not a trigger |
| Pages `- [ ]` checkboxes | Lines in a document | Later, a checkbox can be promoted to a task (see Later) |

## What BB gives us

All of this is in the stable SDK 0.5.29:

- **`bb.sdk.threads.spawn`** with `prompt` or `input`, `projectId`, provider
  and model, and a `pluginMetadata` seed. The seed attributes the thread to
  the plugin, and we store `{ taskId }` in it.
- **Thread lifecycle events** (`bb.events.on`): `thread.active`,
  `thread.idle` (with `lastAssistantText`), `thread.failed` (with the
  error), `interaction.pending` (the agent asked a question or needs a
  permission), `thread.archived`, `thread.unarchived` and `thread.deleted`.
- **`bb.sdk.threads.get`**, whose `status` is `idle | pending | starting |
  active | stopping | error`, for reconciling after a restart. Events
  aren't replayed while the plugin is down.
- **`bb.sdk.threads.send`** to send a follow-up to a handed-off thread from
  the task.
- Agent tools, CLI, mention providers, `messageDirective`, realtime and
  SQLite, as in the other add-ons.

Limits:

- There's no "thread finished its work" signal. `thread.idle` only means
  the agent's turn has ended. That's why an idle thread moves its task to
  **Review** and not **Done**. Only a person, or an agent's explicit
  `tasks_update`, moves a task to Done.
- There's no event when a pending interaction is resolved. The next
  `thread.active` event clears the "Needs you" flag instead.

## The model

A task has:

- **Title**, and a **description** in Markdown.
- **Status**, one of four fixed columns: **To do → In progress → Review →
  Done**. Columns can't be customised in the first version.
- **Project** (or none), like every Studio item.
- **Due date** (optional, a day with no time).
- **Assignee**: **you**, or **an agent**, meaning a provider and model with
  the project's defaults. Bots (from bot-teams) are an open question.
- **Links** to threads, and to Studio items such as pages, artifacts,
  drawings and recordings, stored as `{ pluginId, id }` refs. A linked item
  shows its title and icon from Studio's list.
- **Handoffs**: the threads the task has been handed to, newest first, each
  with its last known state.
- A **rank** within its column, so the board order sticks.

Storage is SQLite, in these tables: `tasks`, `task_links` and
`task_threads` (taskId, threadId, state, updatedAt). The thread's
`pluginMetadata.taskId` is a second pointer, so a task can be found from
its thread.

## The board and the list

The Tasks panel at `/plugins/tasks/tasks` opens on the **board**:

- Four columns with counts. Cards show the title, due date (marked when
  overdue), the assignee, the project and the handoff state.
- Drag cards between and within columns, using native HTML drag and drop
  with no new dependency. Each card also has a ⋯ menu with Move to, for
  keyboard use.
- "+ Add" at the top of each column opens an inline title field. Enter
  creates the task in that column.
- Filters for project, assignee and "mine" (assigned to you), plus Studio's
  project scope.

A **List** toggle shows the same tasks as a table with Status, Due,
Assignee and Project columns, sortable and selectable, for bulk moves.

The **task view** at `tasks/<id>` has Studio's `ItemHeader` (back pill and
editable title), then:

- Status, due date, assignee and project controls.
- The Markdown description.
- **Links**, with an "Add link" picker over Studio's items and the
  project's threads.
- **Handoffs**, one row per thread with its state and an Open button.

Studio's collection also lists tasks as items, with Status, Due and
Assignee facts, a status badge, and the description's first line as the
preview. New in Studio creates a task in To do. The Tasks panel stays in
the sidebar even with Studio installed, because the board is a view Studio
doesn't have.

## Hand to agent

**Hand to agent** is on the card menu, in the task view, and in the CLI:

1. It spawns a thread in the task's project with the chosen provider and
   model. The prompt holds the title, description, due date, and the linked
   items as `@` mentions, so each add-on's `mentionPrompt` adds its context.
   It also asks the agent to call `tasks_update` when the work is ready for
   review. The seed is `pluginMetadata: { taskId }`.
2. The thread becomes a handoff and a link on the task. The assignee
   becomes that agent, and the task moves to **In progress**.
3. Events then move the task:

| Event | Task |
|---|---|
| `thread.active` | **In progress**, and clears Needs you / Failed |
| `interaction.pending` | Stays In progress, with a **Needs you** badge (warning) |
| `thread.idle` | **Review**, with the last reply's first line as the handoff note |
| `thread.failed` | Stays In progress, with a **Failed** badge (danger) and the error |
| `thread.archived` or `thread.deleted` | The handoff is marked closed. The status doesn't change |
| Agent calls `tasks_update { status: "review" }` | **Review** |

   Events only move a task forward from a status the handoff set. If you
   drag a task to Done yourself, a later `thread.idle` won't pull it back to
   Review. Only the latest handoff drives the status.
4. On startup, the plugin re-reads every open handoff with
   `bb.sdk.threads.get` and applies its current state.
5. From Review, you can open the thread, **Send back** (a follow-up message
   through `threads.send`, which moves the task to In progress again), or
   mark it **Done**.

Handing off again starts a new thread, and older handoffs stay listed.

## For agents

- **Tools:**
  - `tasks_list` (filter by project, status or assignee)
  - `tasks_get`
  - `tasks_create`
  - `tasks_update` (status, fields, add or remove links)

  In a handed-off thread, `tasks_update` without an id means "my task", found
  through the thread's `pluginMetadata`.
- **Skill** `tasks`: when to create a task instead of just doing the work,
  how to report being ready for review, and to link the artifacts and pages
  it produced.
- **`@task` mentions** give the agent the task's fields, description and
  links.
- **`::task{id="tsk_…"}`** in a reply shows a live card with status, due
  date and assignee, which opens the task.
- **CLI** `bb tasks`: `list`, `add <title>`, `show <id>`, `move <id>
  <status>`, `hand <id> [--provider] [--model]`, `done <id>`.

## Build order

1. **Core.** Scaffold on SDK 0.5.29 and the kit, with storage and
   migrations, the Studio provider, the list view and task view, the tools,
   the CLI and the skill. Tests for storage, ranking and the provider.
2. **Board.** Columns, drag and drop, inline add, and filters.
3. **Hand to agent.** Spawn, the event state machine, startup
   reconciliation, and Send back. The state machine is a pure function with
   its own tests, including "a manual Done isn't undone".
4. **Mentions, directive and links.** `@task`, `::task`, and the link
   picker over Studio items.
5. **Handoff.** Add Tasks to Studio's `SUITE`, the marketplace and
   `.bb/plugins.json` entries, a staged screenshot of the board with seeded
   tasks in every column (including one with a handoff), a README, and the
   compat check.
6. **Later.**
   - Promote a Pages checkbox to a task. The checkbox then links to the
     task, and ticking either one ticks both.
   - Show due dates on the Automation Calendar.
   - Assign to a bot.
   - Custom columns.

The existing Studio, Pages, Talk, Draw and Artifacts RPCs and hrefs don't
change, which matters for mobile clients. The
only change outside the new package is adding `tasks` to Studio's `SUITE`
list.

## As built

- **Plugin id `studio-tasks`.** BB ships a builtin plugin with the id
  `tasks`, and BB refuses to install another plugin with that id. So the
  package is `@bb-studio/studio-tasks`, the CLI is `bb studio studio-tasks`, the
  skill is `studio-tasks`, and a task lives at
  `/plugins/studio-tasks/tasks/<id>`. The agent tools stay `tasks_list`,
  `tasks_get`, `tasks_create` and `tasks_update`, and the directive stays
  `::task{id="tsk_…"}`.
- **Explicit handoff labels.** An idle thread still moves the task to Review,
  but the card says what happened: "Agent says it's ready for review" when
  the agent called `tasks_update`, "Agent replied, check its answer" when it
  just stopped, and "Agent needs your input" for an open interaction.
- **Archive on Done** is a setting (`archiveThreadsOnDone`, off by default).
  Done also offers "Archive threads" in its toast and in the task's menu.
- **Bots** aren't assignees yet.
- The staged screenshot shows the board without a live handoff, because the
  staged BB has no agent credentials.

## Open questions

- **Idle means Review?** An agent that stops to ask something in plain text,
  and not through an interaction, also ends up in Review. That's probably
  right, since either way it's your turn, but the card should say "Agent
  replied" and not "Ready".
- **Bots as assignees.** Handing a task to a bot-teams bot would go through
  that plugin's channel RPCs, which would be a cross-plugin dependency. Leave
  it for later?
- **Done archives the thread?** Marking a task Done could offer to archive its
  open handoff threads. Offer it (unticked) or leave it alone?
