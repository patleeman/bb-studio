import type { DbConnection } from "@bb/db";
import type { Thread } from "@bb/domain";
import type { ThreadNotWritableErrorDetails } from "@bb/server-contract";
import { ApiError } from "../../errors.js";

// An archived thread refuses new messages with 409 thread_not_writable. When
// a handoff archived it, the thread that continues it is named in that error,
// so a caller can send there instead of guessing (`bb thread tell` reads it).
//
// A handoff (Studio's "continue in a new conversation", a model switch that
// needs a new thread, a lead handoff) spawns the new thread in the same
// project with `handoffFrom: <old thread id>` in a plugin's thread metadata,
// then archives the old one. The successor is the newest such thread; when it
// was handed off in turn, the chain is followed to the first live thread.

/** The plugin metadata key that names the thread a thread continues. */
export const HANDOFF_FROM_METADATA_KEY = "handoffFrom";

const MAX_HOPS = 20;

export interface ThreadSuccessor {
  threadId: string;
  title: string | null;
}

export interface ArchivedThreadErrorDetails extends ThreadNotWritableErrorDetails {
  successorThreadId?: string;
  successorTitle?: string | null;
}

interface SuccessorRow {
  id: string;
  title: string | null;
  title_fallback: string | null;
  archived_at: number | null;
}

/** The newest live-or-archived thread that continues `threadId` in `projectId`, or null. */
export type NextHandoff = (
  projectId: string,
  threadId: string,
) => SuccessorRow | null;

const NEXT_HANDOFF_SQL = `
  SELECT t.id, t.title, t.title_fallback, t.archived_at
  FROM threads t
  JOIN thread_plugin_metadata m ON m.thread_id = t.id
  WHERE t.project_id = ?
    AND t.deleted_at IS NULL
    AND CASE WHEN json_valid(m.metadata_json)
      THEN json_extract(m.metadata_json, '$.${HANDOFF_FROM_METADATA_KEY}')
    END = ?
  ORDER BY t.created_at DESC, t.id DESC
  LIMIT 1`;

let nextHandoff: NextHandoff | null = null;

/** Lets archived-thread errors name the live successor. Called once from createApp. */
export function registerForkThreadSuccessors(db: DbConnection): () => void {
  const statement = db.$client.prepare<[string, string], SuccessorRow>(
    NEXT_HANDOFF_SQL,
  );
  const lookup: NextHandoff = (projectId, threadId) =>
    statement.get(projectId, threadId) ?? null;
  nextHandoff = lookup;
  return () => {
    if (nextHandoff === lookup) nextHandoff = null;
  };
}

/** Follows the handoff chain from `thread` to the first thread that is not archived. */
export function findLiveSuccessor(
  thread: Pick<Thread, "id" | "projectId">,
  next: NextHandoff,
): ThreadSuccessor | null {
  const seen = new Set([thread.id]);
  let current = thread.id;
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    const row = next(thread.projectId, current);
    if (row === null || seen.has(row.id)) return null;
    if (row.archived_at === null) {
      return { threadId: row.id, title: row.title ?? row.title_fallback };
    }
    seen.add(row.id);
    current = row.id;
  }
  return null;
}

function liveSuccessor(
  thread: Pick<Thread, "id" | "projectId">,
): ThreadSuccessor | null {
  if (nextHandoff === null) return null;
  try {
    return findLiveSuccessor(thread, nextHandoff);
  } catch {
    // The refusal must not fail because the lookup did.
    return null;
  }
}

/** The 409 for a send to an archived thread, naming its live successor when a handoff recorded one. */
export function throwArchivedThread(
  thread: Pick<Thread, "id" | "projectId" | "archivedAt" | "status">,
): never {
  const successor = liveSuccessor(thread);
  const details: ArchivedThreadErrorDetails = {
    reason: "archived",
    archivedAt: thread.archivedAt,
    threadStatus: thread.status,
    ...(successor === null
      ? {}
      : {
          successorThreadId: successor.threadId,
          successorTitle: successor.title,
        }),
  };
  throw new ApiError(
    409,
    "thread_not_writable",
    successor === null
      ? "Thread is archived"
      : `Thread is archived. It continues in thread ${successor.threadId}.`,
    { details },
  );
}
