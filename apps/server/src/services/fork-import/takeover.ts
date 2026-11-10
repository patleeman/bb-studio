import Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ServerLogger } from "../../types.js";
import {
  getMirroredThread,
  openForkImportDatabase,
  readForkImportState,
} from "./state.js";
import { runForkImportSync } from "./sync.js";

type Sqlite = Database.Database;

const RUNNING_STATUSES = ["starting", "active", "stopping"];

export const TAKE_OVER_NOTE =
  "This thread now belongs to BB Studio. The copy in bb is separate from here on: what happens there no longer shows up here, and nothing done here goes back.";

export type TakeOverRefusal =
  | "not_mirrored"
  | "already_taken_over"
  | "source_running"
  | "source_has_queued_messages";

export class TakeOverRefusedError extends Error {
  constructor(
    readonly reason: TakeOverRefusal,
    message: string,
  ) {
    super(message);
  }
}

export interface SourceThreadActivity {
  status: string | null;
  queuedMessages: number;
}

export function readSourceThreadActivity(
  sourceDataDir: string,
  threadId: string,
): SourceThreadActivity | null {
  const path = join(sourceDataDir, "bb.db");
  if (!existsSync(path)) return null;
  const source = new Database(path, { fileMustExist: true, readonly: true });
  try {
    source.pragma("busy_timeout = 2000");
    const thread = source
      .prepare<[string], { status: string }>(
        "SELECT status FROM threads WHERE id = ?",
      )
      .get(threadId);
    const queued =
      source
        .prepare<[string], { count: number }>(
          "SELECT COUNT(*) AS count FROM queued_thread_messages WHERE thread_id = ?",
        )
        .get(threadId)?.count ?? 0;
    return { status: thread?.status ?? null, queuedMessages: queued };
  } finally {
    source.close();
  }
}

export function readHostId(dataDir: string): string | null {
  try {
    const value = readFileSync(join(dataDir, "host-id"), "utf8").trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

function rehomeEnvironment(args: {
  database: Sqlite;
  dataDir: string;
  threadId: string;
  sourceHostId: string | null;
  now: number;
}): void {
  const { database } = args;
  const ourHostId = readHostId(args.dataDir);
  if (ourHostId === null || args.sourceHostId === null) return;
  const environment = database
    .prepare<
      [string],
      { id: string; project_id: string; host_id: string; path: string | null }
    >(
      `SELECT environments.id, environments.project_id, environments.host_id, environments.path
       FROM threads JOIN environments ON environments.id = threads.environment_id
       WHERE threads.id = ?`,
    )
    .get(args.threadId);
  if (environment === undefined || environment.host_id !== args.sourceHostId) {
    return;
  }
  if (
    database.prepare("SELECT 1 FROM hosts WHERE id = ?").get(ourHostId) ===
    undefined
  ) {
    return;
  }
  const fork = openForkImportDatabase(args.dataDir);
  const twin = database
    .prepare<[string, string, string | null], { id: string }>(
      "SELECT id FROM environments WHERE project_id = ? AND host_id = ? AND path IS ?",
    )
    .get(environment.project_id, ourHostId, environment.path);
  if (twin !== undefined) {
    database
      .prepare("UPDATE threads SET environment_id = ? WHERE id = ?")
      .run(twin.id, args.threadId);
    return;
  }
  database
    .prepare("UPDATE environments SET host_id = ?, updated_at = ? WHERE id = ?")
    .run(ourHostId, args.now, environment.id);
  fork
    .prepare(
      "INSERT OR IGNORE INTO taken_over_environments (environment_id, taken_over_at) VALUES (?, ?)",
    )
    .run(environment.id, args.now);
}

export function takeOverMirroredThread(args: {
  dataDir: string;
  database: Sqlite;
  logger: Pick<ServerLogger, "info" | "warn">;
  threadId: string;
  now: number;
}): { note: string } {
  const mirrored = getMirroredThread(args.dataDir, args.threadId);
  if (mirrored === null) {
    throw new TakeOverRefusedError(
      "not_mirrored",
      "This thread is not mirrored from bb.",
    );
  }
  if (mirrored.takenOverAt !== null) {
    throw new TakeOverRefusedError(
      "already_taken_over",
      "This thread was already taken over.",
    );
  }
  const state = readForkImportState(args.dataDir);
  if (state !== null) {
    const activity = readSourceThreadActivity(
      state.sourceDataDir,
      args.threadId,
    );
    if (
      activity?.status !== null &&
      activity?.status !== undefined &&
      RUNNING_STATUSES.includes(activity.status)
    ) {
      throw new TakeOverRefusedError(
        "source_running",
        "This thread is running in bb. Wait until it finishes there, or stop it there, then take it over.",
      );
    }
    if (activity !== null && activity.queuedMessages > 0) {
      throw new TakeOverRefusedError(
        "source_has_queued_messages",
        "This thread has queued messages in bb. Send or remove them there, then take it over.",
      );
    }
    runForkImportSync({
      dataDir: args.dataDir,
      database: args.database,
      logger: args.logger,
      now: args.now,
    });
  }
  args.database.transaction(() => {
    rehomeEnvironment({
      database: args.database,
      dataDir: args.dataDir,
      threadId: args.threadId,
      sourceHostId: state?.sourceServerHostId ?? null,
      now: args.now,
    });
  })();
  openForkImportDatabase(args.dataDir)
    .prepare(
      "UPDATE mirrored_threads SET taken_over_at = ? WHERE thread_id = ?",
    )
    .run(args.now, args.threadId);
  args.logger.info({ threadId: args.threadId }, "Mirrored thread taken over");
  return { note: TAKE_OVER_NOTE };
}
