import Database from "better-sqlite3";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { turnScope } from "@bb/domain";
import { afterEach, describe, expect, it } from "vitest";
import { runForkFirstRunImport } from "../../src/services/fork-import/first-run.js";
import {
  closeForkImportDatabases,
  isMirroredReadOnly,
  openForkImportDatabase,
} from "../../src/services/fork-import/state.js";
import { runForkImportSync } from "../../src/services/fork-import/sync.js";
import { takeOverMirroredThread } from "../../src/services/fork-import/takeover.js";
import { seedEvent, seedThread, seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const roots: string[] = [];
const open: Database.Database[] = [];
const logger = { info: () => {}, warn: () => {} };

afterEach(async () => {
  for (const database of open.splice(0)) database.close();
  closeForkImportDatabases();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function importedPair(): Promise<{
  source: Database.Database;
  target: Database.Database;
  dataDir: string;
  threadId: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "bb-fork-sync-"));
  roots.push(root);
  const sourceDir = join(root, "source");
  const dataDir = join(root, "target");
  await mkdir(sourceDir, { recursive: true });
  let threadId = "";
  await withTestHarness(async (harness) => {
    const { project, environment } = seedThreadFixture(harness);
    const thread = seedThread(harness.deps, {
      projectId: project.id,
      environmentId: environment.id,
      status: "active",
      title: "From BB",
    });
    threadId = thread.id;
    for (const sequence of [1, 2]) {
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-1",
        scope: turnScope("turn-1"),
        sequence,
        type: "item/completed",
        data: {
          item: { type: "agentMessage", id: `m${sequence}`, text: "hi" },
        },
      });
    }
    await harness.db.$client.backup(join(sourceDir, "bb.db"));
  });
  await writeFile(join(sourceDir, "host-id"), "host_source\n");
  await runForkFirstRunImport({
    dataDir,
    env: { BB_STUDIO_IMPORT_FROM: sourceDir },
    logger,
    now: 1000,
    appVersion: "1.0.0",
  });
  const source = new Database(join(sourceDir, "bb.db"));
  const target = new Database(join(dataDir, "bb.db"));
  target.pragma("foreign_keys = ON");
  open.push(source, target);
  return { source, target, dataDir, threadId };
}

function addSourceEvent(
  source: Database.Database,
  threadId: string,
  sequence: number,
): void {
  source
    .prepare(
      `INSERT INTO events (id, thread_id, environment_id, scope_kind, turn_id, provider_thread_id, sequence, type, item_id, item_kind, data, created_at)
       SELECT 'evt_new_' || @sequence, thread_id, environment_id, scope_kind, turn_id, provider_thread_id, @sequence, type, item_id, item_kind, data, created_at
       FROM events WHERE thread_id = @threadId ORDER BY sequence LIMIT 1`,
    )
    .run({ threadId, sequence });
}

function eventCount(database: Database.Database, threadId: string): number {
  return (
    database
      .prepare<[string], { count: number }>(
        "SELECT COUNT(*) AS count FROM events WHERE thread_id = ?",
      )
      .get(threadId)?.count ?? 0
  );
}

describe("one-way sync from the source bb", () => {
  it("imports a running thread as idle and read-only", async () => {
    const { target, dataDir, threadId } = await importedPair();

    expect(
      target.prepare("SELECT status FROM threads WHERE id = ?").get(threadId),
    ).toEqual({ status: "idle" });
    expect(isMirroredReadOnly(dataDir, threadId)).toBe(true);
    expect(isMirroredReadOnly(dataDir, "thr_local")).toBe(false);
  });

  it("appends new events and thread changes, and reloads a thread whose earlier events changed", async () => {
    const { source, target, dataDir, threadId } = await importedPair();
    addSourceEvent(source, threadId, 3);
    source
      .prepare(
        "UPDATE threads SET title = 'Renamed', updated_at = updated_at + 5 WHERE id = ?",
      )
      .run(threadId);

    const first = runForkImportSync({
      dataDir,
      database: target,
      logger,
      now: 2000,
    });

    expect(first?.eventsAdded).toBe(1);
    expect(eventCount(target, threadId)).toBe(3);
    expect(
      target
        .prepare("SELECT title, status FROM threads WHERE id = ?")
        .get(threadId),
    ).toEqual({ title: "Renamed", status: "idle" });

    source
      .prepare("DELETE FROM events WHERE thread_id = ? AND sequence = 1")
      .run(threadId);
    addSourceEvent(source, threadId, 4);
    const second = runForkImportSync({
      dataDir,
      database: target,
      logger,
      now: 3000,
    });

    expect(second?.eventReloads).toBe(1);
    expect(
      target
        .prepare(
          "SELECT sequence FROM events WHERE thread_id = ? ORDER BY sequence",
        )
        .all(threadId),
    ).toEqual([{ sequence: 2 }, { sequence: 3 }, { sequence: 4 }]);
  });

  it("leaves a taken-over thread alone", async () => {
    const { source, target, dataDir, threadId } = await importedPair();
    openForkImportDatabase(dataDir)
      .prepare(
        "UPDATE mirrored_threads SET taken_over_at = 1 WHERE thread_id = ?",
      )
      .run(threadId);
    addSourceEvent(source, threadId, 3);
    source
      .prepare(
        "UPDATE threads SET title = 'Changed in BB', updated_at = updated_at + 5 WHERE id = ?",
      )
      .run(threadId);

    runForkImportSync({ dataDir, database: target, logger, now: 2000 });

    expect(eventCount(target, threadId)).toBe(2);
    expect(
      target.prepare("SELECT title FROM threads WHERE id = ?").get(threadId),
    ).toEqual({ title: "From BB" });
  });

  it("removes a mirrored thread that was deleted at the source", async () => {
    const { source, target, dataDir, threadId } = await importedPair();
    source.prepare("DELETE FROM threads WHERE id = ?").run(threadId);

    const summary = runForkImportSync({
      dataDir,
      database: target,
      logger,
      now: 60 * 60_000,
    });

    expect(summary?.threadsDeleted).toBe(1);
    expect(
      target.prepare("SELECT id FROM threads WHERE id = ?").get(threadId),
    ).toBeUndefined();
  });

  it("never writes to the source database", async () => {
    const { source, target, dataDir } = await importedPair();
    const before = source.pragma("data_version", { simple: true });

    runForkImportSync({ dataDir, database: target, logger, now: 2000 });

    expect(source.pragma("data_version", { simple: true })).toBe(before);
  });

  it("refuses a take-over while the thread runs or has queued messages at the source, then makes it writable", async () => {
    const { source, target, dataDir, threadId } = await importedPair();
    const takeOver = () =>
      takeOverMirroredThread({
        dataDir,
        database: target,
        logger,
        threadId,
        now: 5000,
      });

    expect(takeOver).toThrowError(
      expect.objectContaining({ reason: "source_running" }),
    );
    expect(isMirroredReadOnly(dataDir, threadId)).toBe(true);

    source
      .prepare("UPDATE threads SET status = 'idle' WHERE id = ?")
      .run(threadId);
    addSourceEvent(source, threadId, 3);
    expect(takeOver().note).toContain("separate");

    expect(isMirroredReadOnly(dataDir, threadId)).toBe(false);
    expect(eventCount(target, threadId)).toBe(3);
    expect(takeOver).toThrowError(
      expect.objectContaining({ reason: "already_taken_over" }),
    );
  });

  it("moves the thread's environment to this machine at take-over and stops syncing that environment", async () => {
    const { source, target, dataDir, threadId } = await importedPair();
    const environment = target
      .prepare<[string], { id: string; host_id: string }>(
        "SELECT environments.id, environments.host_id FROM threads JOIN environments ON environments.id = threads.environment_id WHERE threads.id = ?",
      )
      .get(threadId);
    if (environment === undefined)
      throw new Error("fixture has no environment");
    const statePath = join(dataDir, "fork-import.json");
    const state = JSON.parse(readFileSync(statePath, "utf8")) as Record<
      string,
      unknown
    >;
    writeFileSync(
      statePath,
      JSON.stringify({ ...state, sourceServerHostId: environment.host_id }),
    );
    const columns = target
      .prepare<[], { name: string }>(
        "SELECT name FROM pragma_table_info('hosts')",
      )
      .all()
      .map((column) => column.name);
    target
      .prepare(
        `INSERT INTO hosts (${columns.join(", ")}) SELECT ${columns.map((column) => (column === "id" ? "'host_ours'" : column)).join(", ")} FROM hosts WHERE id = ?`,
      )
      .run(environment.host_id);
    writeFileSync(join(dataDir, "host-id"), "host_ours\n");
    source
      .prepare("UPDATE threads SET status = 'idle' WHERE id = ?")
      .run(threadId);

    takeOverMirroredThread({
      dataDir,
      database: target,
      logger,
      threadId,
      now: 5000,
    });

    expect(
      target
        .prepare("SELECT host_id FROM environments WHERE id = ?")
        .get(environment.id),
    ).toEqual({ host_id: "host_ours" });
    source
      .prepare(
        "UPDATE environments SET updated_at = updated_at + 50 WHERE id = ?",
      )
      .run(environment.id);
    runForkImportSync({ dataDir, database: target, logger, now: 6000 });
    expect(
      target
        .prepare("SELECT host_id FROM environments WHERE id = ?")
        .get(environment.id),
    ).toEqual({ host_id: "host_ours" });
  });
});
