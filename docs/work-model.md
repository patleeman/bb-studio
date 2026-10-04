# The work model

The design lives on the Studio page "How I work: the BB work model"
(pg_7fe6aafc7a1c7c05). In short: **Projects, Threads and the Inbox.**

- A **project** is a BB project (not the Personal one). It has a **lead**: a
  thread you talk to, which keeps the project's **page** current and starts
  sub-threads in the project. The page holds the brief, plan, decisions and
  the project's **memory**, shared by every thread in it.
- **Threads** in the sidebar are the one-offs: your Personal project's threads.
- The **Inbox** gathers what needs you and every report, from everywhere.

## Web UI (`packages/bb-studio/src/ui/work/`)

| Surface | What it shows |
|---|---|
| Sidebar navigation | BB's own items, drawn as BB draws them. Of Studio's panels only Inbox, Projects and Library are listed; the rest serve item links only. |
| Sidebar list | **Projects** (one row each, with a needs-you or running mark) and **Threads** (one-offs). |
| Projects panel | `/plugins/studio/projects/<projectId>`: the lead's chat in the middle, or BB's composer to start the lead. Header: New thread (a sub-thread in the project). |
| Workbench | Two fixed tabs on the Projects panel: **Page** (the real Pages editor, embedded through the kit float registry) and **Threads** (the project's other threads). |

## Backend

`project_get`, `project_setup` (spawns the lead from the composer request and
creates the page) and `project_threads` in the office contract; see
`packages/bb-studio/src/office/projects.ts`.
