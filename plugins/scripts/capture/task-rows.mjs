export function taskFromLoop(loop) {
  const closed = loop.status === "done" || loop.status === "dropped";
  const state = closed ? loop.status : loop.status === "in_progress" ? "in_progress" : loop.kind === "waiting" ? "waiting" : "todo";
  const queue = closed || loop.status === "in_progress" ? null : loop.status === "surfaced" ? "surfaced" : "queued";
  return {
    id: loop.id, title: loop.title, why: loop.why ?? "", owner: loop.owner, state, kind: loop.kind === "waiting" ? "waiting-outside" : loop.kind,
    options: loop.options ?? [], needs: null, priority: loop.priority ?? "normal", conversation: null, project: null, area: loop.area ?? null,
    timing: { due: loop.due ?? null, trigger: loop.trigger ?? { type: "none" }, snoozed: loop.status === "snoozed" },
    attention: { queue, push: loop.push ?? false }, progress: { step: null, line: null }, workers: [], outputs: [], source: loop.source ?? null,
    parentId: null, schedule: null, card: null, stale: false, origin: "loop",
    createdAt: loop.createdAt, updatedAt: loop.updatedAt, closedAt: closed ? loop.closedAt ?? loop.updatedAt : null, closedBy: closed ? loop.closedBy ?? "cos" : null,
  };
}

export function writeLoopTasks(db, loops) {
  const insert = db.prepare("INSERT OR REPLACE INTO tasks (id, record, owner, state, origin, conversation, parent_id, created_at, updated_at, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const loop of loops) {
    const t = taskFromLoop(loop);
    insert.run(t.id, JSON.stringify(t), t.owner, t.state, t.origin, t.conversation, t.parentId, t.createdAt, t.updatedAt, t.closedAt);
  }
}

export function deleteTasks(db, prefix) {
  db.prepare("DELETE FROM task_events WHERE task_id LIKE ?").run(`${prefix}%`);
  db.prepare("DELETE FROM tasks WHERE id LIKE ?").run(`${prefix}%`);
}
