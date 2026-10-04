# Project hubs

A hub belongs to a standard BB project. Personal workspaces are excluded. Opening
an existing hub is read-only except for clearing confirmed missing references.
Setup creates a page and lead only when they are missing; it does not send another
message to an existing lead or overwrite an existing page's Brief.

- `project_get({ projectId })` returns `{ projectId, name, leadThreadId, pageId,
  pageHref }`. The three reference fields are nullable.
- `project_setup({ projectId, request })` returns the same shape. `request` is the
  native composer request used by `office_start`. The outer projectId owns the
  hub and overrides request.projectId. Execution settings, attachments, and the
  user's input are preserved. Lead instructions precede that input.
- `project_threads({ projectId })` returns `{ threads: [{ id, title, status,
  updatedAt, isLead }] }`. Titles may be null. This uses BB's default thread
  visibility, filters to top-level threads, pages through the list, and sorts
  by updatedAt descending, with id as a stable tie-breaker.

`office_projects` persists each external creation before the next step, so a
failed spawn can reuse its page. Requests are serialized per project in the
running service. External creation and SQLite cannot share a transaction: a
process crash or lost response between external creation and saving its ID may
leave an unlinked object. No existing object is deleted during recovery.

Pages live in their project, use the 📁 icon, and start with Brief, Plan,
Decisions, Memory, and Links. Brief contains the user's text. The lead is titled
`<project name> · lead`, unpinned, and has Studio plugin metadata
`{ role: "project-lead", projectId, pageId }`. Its instructions establish shared
project memory, worker coordination, and progress reporting to the Studio Inbox.

A missing page (`pages.get` returns null) or deleted thread (404) clears its
stored reference. A thread moved to another project also stops being this
project's lead. Provider/network errors propagate and preserve references.
Studio realtime changes publish after each saved reference change.
