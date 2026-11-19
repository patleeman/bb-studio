import type Database from "better-sqlite3";
import { createEventId } from "@bb/db";
import {
  backgroundTaskItemStatus,
  convertLegacyStoredThreadEvent,
  isSettledBackgroundTaskStatus,
  threadEventBackgroundTaskItemSchema,
} from "@bb/domain";

type Sqlite = Database.Database;

export const BROUGHT_OVER_OPERATION = "brought_over_from_bb";
export const BROUGHT_OVER_MESSAGE =
  "Brought over from bb. Anything that was running there was not resumed here.";

interface OpenTaskRow {
  data: string;
  environment_id: string | null;
  item_id: string;
  provider_thread_id: string | null;
  sequence: number;
  type: string;
}

const TASK_EVENT_TYPES = [
  "item/started",
  "item/backgroundTask/progress",
  "item/backgroundTask/completed",
];

function openBackgroundTasks(target: Sqlite, threadId: string): OpenTaskRow[] {
  const byType = target.prepare<[string, string], OpenTaskRow>(
    `SELECT data, environment_id, item_id, provider_thread_id, sequence, type FROM events
     WHERE thread_id = ? AND type = ? AND item_kind = 'backgroundTask' AND item_id IS NOT NULL`,
  );
  const latest = new Map<string, OpenTaskRow>();
  const settled = new Set<string>();
  for (const type of TASK_EVENT_TYPES) {
    for (const row of byType.all(threadId, type)) {
      if (type === "item/backgroundTask/completed") settled.add(row.item_id);
      const current = latest.get(row.item_id);
      if (current === undefined || row.sequence > current.sequence) {
        latest.set(row.item_id, row);
      }
    }
  }
  return [...latest.values()]
    .filter((row) => !settled.has(row.item_id))
    .sort((a, b) => a.sequence - b.sequence);
}

function parseTask(row: OpenTaskRow) {
  try {
    const data = JSON.parse(row.data) as unknown;
    if (typeof data !== "object" || data === null) return null;
    const stored = convertLegacyStoredThreadEvent({
      type: row.type as Parameters<
        typeof convertLegacyStoredThreadEvent
      >[0]["type"],
      data: data as Record<string, unknown>,
    });
    const item = (stored.data as { item?: unknown }).item;
    const parsed = threadEventBackgroundTaskItemSchema.safeParse(item);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function settleBroughtOverThread(
  target: Sqlite,
  args: { threadId: string; environmentId: string | null; now: number },
): void {
  const columns = new Set(
    target
      .prepare<[], { name: string }>(
        "SELECT name FROM pragma_table_info('events')",
      )
      .all()
      .map((column) => column.name),
  );
  let sequence =
    target
      .prepare<[string], { value: number | null }>(
        "SELECT MAX(sequence) AS value FROM events WHERE thread_id = ?",
      )
      .get(args.threadId)?.value ?? 0;
  const append = (row: Record<string, unknown>) => {
    sequence += 1;
    const values: Record<string, unknown> = {
      id: createEventId(),
      thread_id: args.threadId,
      scope_kind: "thread",
      turn_id: null,
      sequence,
      created_at: args.now,
      ...row,
    };
    const names = Object.keys(values).filter((name) => columns.has(name));
    target
      .prepare(
        `INSERT INTO events (${names.map((name) => `"${name}"`).join(", ")}) VALUES (${names.map((name) => `@${name}`).join(", ")})`,
      )
      .run(Object.fromEntries(names.map((name) => [name, values[name]])));
  };
  for (const row of openBackgroundTasks(target, args.threadId)) {
    const item = parseTask(row);
    if (item === null) continue;
    const taskStatus = isSettledBackgroundTaskStatus(item.taskStatus)
      ? item.taskStatus
      : "stopped";
    const { ownerStopped: _ownerStopped, ...rest } = item;
    const settled = {
      ...rest,
      status: backgroundTaskItemStatus(taskStatus),
      taskStatus,
    };
    const providerThreadId = row.provider_thread_id ?? "";
    append({
      environment_id: row.environment_id,
      provider_thread_id: providerThreadId,
      type: "item/backgroundTask/completed",
      item_id: settled.id,
      item_kind: "backgroundTask",
      parent_tool_call_id: settled.parentToolCallId ?? null,
      data: JSON.stringify({ providerThreadId, item: settled }),
    });
  }
  append({
    environment_id: args.environmentId,
    provider_thread_id: null,
    type: "system/operation",
    item_id: null,
    item_kind: null,
    parent_tool_call_id: null,
    data: JSON.stringify({
      operation: BROUGHT_OVER_OPERATION,
      operationId: createEventId(),
      status: "completed",
      message: BROUGHT_OVER_MESSAGE,
    }),
  });
}
