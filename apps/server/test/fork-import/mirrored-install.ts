import Database from "better-sqlite3";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readPrimaryHostIdFromDataDir } from "../../src/services/hosts/primary-host.js";
import {
  FORK_IMPORT_STATE_FILE_NAME,
  openForkImportDatabase,
} from "../../src/services/fork-import/state.js";

export async function createMirroredInstall(args: {
  dataDir: string;
  sourceDataDir: string;
  now: number;
}): Promise<void> {
  await mkdir(args.dataDir, { recursive: true });
  const source = new Database(join(args.sourceDataDir, "bb.db"), {
    readonly: true,
  });
  const statuses = new Map(
    source
      .prepare<[], { id: string; status: string }>(
        "SELECT id, status FROM threads",
      )
      .all()
      .map((row) => [row.id, row.status]),
  );
  await source.backup(join(args.dataDir, "bb.db"));
  source.close();
  const db = new Database(join(args.dataDir, "bb.db"));
  db.exec(`
    UPDATE threads SET status = 'idle' WHERE status IN ('starting', 'active', 'stopping');
    DELETE FROM host_daemon_sessions;
    DELETE FROM queued_thread_messages;
    DELETE FROM pending_interactions;
    DELETE FROM terminal_sessions;
  `);
  const eventRowid =
    db
      .prepare<[], { rowid: number | null }>(
        "SELECT MAX(rowid) AS rowid FROM events",
      )
      .get()?.rowid ?? 0;
  const threads = db
    .prepare<[], { id: string; updated_at: number }>(
      "SELECT id, updated_at FROM threads",
    )
    .all();
  db.close();
  await writeFile(
    join(args.dataDir, FORK_IMPORT_STATE_FILE_NAME),
    `${JSON.stringify({
      version: 1,
      sourceDataDir: args.sourceDataDir,
      sourceServerHostId: readPrimaryHostIdFromDataDir({
        dataDir: args.sourceDataDir,
      }),
      importedAt: args.now,
      sourceEventRowid: eventRowid,
    })}\n`,
  );
  const fork = openForkImportDatabase(args.dataDir);
  const insert = fork.prepare(
    "INSERT OR IGNORE INTO mirrored_threads (thread_id, source_updated_at, source_status) VALUES (?, ?, ?)",
  );
  for (const thread of threads) {
    insert.run(thread.id, thread.updated_at, statuses.get(thread.id) ?? "idle");
  }
}
