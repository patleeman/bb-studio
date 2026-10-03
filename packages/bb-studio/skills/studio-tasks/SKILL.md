---
name: studio-tasks
description: Use when the user asks to track, add, list or update a task, to-do or task board ("add a task", "what's on my board", "make a board for the launch", "hand this to an agent"), when a thread was handed a task from Studio Tasks (its first message says "Work on this task from Studio Tasks"), or when they refer to a /plugins/studio-tasks/tasks/<id> link or an @task mention.
---

# Studio Tasks

Studio Tasks keeps tasks on boards. Each project has a main board,
"Tasks", where tasks go when no board is named, and the user can make
others (for a launch, a sprint). A board's columns are its own; the default
is **To do**, **In progress**, **Review** and **Done**, and Done is always
last. Board ids look like `brd_…`; link to one as
`[Title](/plugins/studio-tasks/tasks/<board-id>)`. A task has a title, a Markdown
description, a due day, an assignee (the user, an agent, or nobody), a
project (or none, for global), and links to threads and Studio items (pages,
artifacts, drawings, recordings). Link to a task as
`[Title](/plugins/studio-tasks/tasks/<task-id>)`.

## Handoffs

The user can hand a task to an agent. That starts a thread whose first
message is the task, with its links as mentions. The task then follows the
thread:

| Thread | Label on the task | Column |
| --- | --- | --- |
| Starting | Starting agent | In progress |
| Working | Agent working | In progress |
| Asked a question or needs a permission | Agent needs your input | stays |
| Turn ended | Agent replied, check its answer | Review |
| Agent called `tasks_update` with status "review" | Agent says it's ready for review | Review |
| Failed | Agent failed | stays |
| Archived / deleted | Thread archived / Thread deleted | stays |

Only the task's newest handoff moves it, and only between In progress and
Review. A task the user moved to To do or Done stays there.

**If you're working on a handed-off task:** when the work is ready, call
`tasks_update` with `status: "review"` and a one-line `note` saying what you
did. Link what you made with `addLinks` (for a saved artifact,
`{ pluginId: "studio", itemId: "art_…", label: "…" }`). Don't mark the
task done: the user does that after reviewing. The user may send feedback
back into your thread, which moves the task to In progress again.

## Agent tools

| Tool | Use it to |
| --- | --- |
| `tasks_boards` | List boards with ids, project, columns and counts. |
| `tasks_board_create` | Make a board, in this thread's project unless `global`, with optional `columns` (names before Done). |
| `tasks_list` | List tasks with ids, board, status, assignee, due day and handoff state. Filter by `boardId`, `status` or `query`. |
| `tasks_get` | Read a task's description, links and handoffs. Without `id`, the task this thread was handed. |
| `tasks_create` | Add a task (the board's first column unless you pass `status`) to `boardId`, or this thread's project's main board. Only when the user asks to track something, not for your own plan. |
| `tasks_update` | Change status (not Done), board, title, description, due, add links, or set your handoff's `note`. Without `id`, this thread's task. |

`tasks_create` returns a line like `::task{id="tsk_…"}`. Put it on its own
line in your reply and the user sees a card that opens the task. To show a
board in a Studio page, embed it: `{"kind":"board","target":"brd_…"}`, or
`"brd_…/view/list"` for a checklist.

## CLI (works in every agent session)

```sh
bb studio studio-tasks boards
bb studio studio-tasks board <title> [--global]                # in this project unless --global
bb studio studio-tasks list [--board <id>] [--status <column>]
bb studio studio-tasks add <title> [--board <id>] [--description <text>] [--due <YYYY-MM-DD>] [--me]
bb studio studio-tasks show <id>
bb studio studio-tasks move <id> <column>
bb studio studio-tasks hand <id> [--note <text>] [--folder]   # new thread, project's default agent
bb studio studio-tasks done <id>
```

## Settings

**Archive threads when a task is done** (off by default): moving a task to
Done archives the threads it was handed to. With it off, Tasks offers
**Archive threads** after you mark a task done.

## Studio

Tasks is a BB Studio add-on. With the Studio plugin installed, boards (kind
`board`) and tasks (kind `task`, children of their board) appear in
Studio's collection; tasks have Status, Due and Assignee columns and **Mark
done** / **Move to To do** actions. The Tasks panel lists boards either way.
