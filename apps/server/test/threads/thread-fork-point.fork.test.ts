import { describe, expect, it } from "vitest";
import {
  createProject,
  createThread,
  getLatestThreadSequence,
  insertEvents,
  noopNotifier,
  upsertHost,
  type DbConnection,
} from "@bb/db";
import { createMigratedConnection } from "@bb/db/testing";
import { threadScope, turnScope } from "@bb/domain";
import { readThreadForkPoint } from "../../src/services/threads/thread-fork-point.fork.js";
import { forkPluginHooks } from "../../src/services/threads/turn-classifiers.fork.js";
import { copyForkSourceHistory } from "../../src/services/threads/thread-fork-history.js";
import { NotificationHub } from "../../src/ws/hub.js";

function copyingStartupContext(): string {
  return JSON.stringify({
    kind: "pending",
    environmentIntent: { type: "reuse", environmentId: "env_fork_point" },
    fork: null,
    historyCopy: "copying",
    startedOnBehalfOf: null,
    titleProvided: false,
  });
}

function addTurns(db: DbConnection, threadId: string, turnIds: string[]) {
  let sequence = getLatestThreadSequence(db, { threadId });
  const event = (
    type: "turn/started" | "item/completed" | "turn/completed",
    turnId: string,
    data: Record<string, unknown>,
  ) => ({
    createdAt: 1_800_000_000_000 + sequence,
    data: JSON.stringify(data),
    itemId: null,
    itemKind: null,
    parentToolCallId: null,
    providerThreadId: "provider-fork-point",
    scope: turnScope(turnId),
    sequence: ++sequence,
    threadId,
    type,
  });
  insertEvents(
    db,
    noopNotifier,
    turnIds.flatMap((turnId) => [
      event("turn/started", turnId, {}),
      event("turn/completed", turnId, { status: "completed" }),
    ]),
  );
  return sequence;
}

function completedSequence(
  db: DbConnection,
  threadId: string,
  turnId: string,
): number {
  const row = db.$client
    .prepare(
      "SELECT sequence FROM events WHERE thread_id = ? AND type = 'turn/completed' AND turn_id = ?",
    )
    .get(threadId, turnId) as { sequence: number };
  return row.sequence;
}

function seed(db: DbConnection) {
  const host = upsertHost(db, noopNotifier, { name: "fork-point-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "fork-point-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/fork-point" },
  });
  const source = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
  });
  const forkOf = (sourceThreadId: string) =>
    createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      status: "pending",
      sourceThreadId,
      originKind: "fork",
      startupContext: copyingStartupContext(),
    });
  return { project, source, forkOf };
}

describe("where a fork branched off", () => {
  it("names the source turn the copied history ends with, after both threads moved on", async () => {
    const db = createMigratedConnection();
    const deps = { db, hub: new NotificationHub() };
    const { source, forkOf } = seed(db);
    addTurns(db, source.id, ["turn-a", "turn-b"]);
    const historyEndSequence = completedSequence(db, source.id, "turn-b");
    addTurns(db, source.id, ["turn-c"]);
    const fork = forkOf(source.id);
    await copyForkSourceHistory(deps, {
      fork,
      historyEndSequence,
      sourceThreadId: source.id,
    });
    addTurns(db, fork.id, ["fork-turn-1"]);
    addTurns(db, source.id, ["turn-d"]);

    expect(readThreadForkPoint(db, fork.id)).toEqual({
      sourceThreadId: source.id,
      sourceTurnId: "turn-b",
      sourceSequence: historyEndSequence,
    });

    const forkOfFork = forkOf(fork.id);
    await copyForkSourceHistory(deps, {
      fork: forkOfFork,
      historyEndSequence: completedSequence(db, fork.id, "fork-turn-1"),
      sourceThreadId: fork.id,
    });
    expect(readThreadForkPoint(db, forkOfFork.id)).toEqual({
      sourceThreadId: fork.id,
      sourceTurnId: "fork-turn-1",
      sourceSequence: completedSequence(db, fork.id, "fork-turn-1"),
    });
    db.$client.close();
  });

  it("knows the source but no point when the fork copied no history", () => {
    const db = createMigratedConnection();
    const { source, forkOf } = seed(db);
    addTurns(db, source.id, ["turn-a"]);
    const fork = forkOf(source.id);
    insertEvents(db, noopNotifier, [
      {
        createdAt: 1,
        data: JSON.stringify({ message: "note" }),
        itemId: null,
        itemKind: null,
        parentToolCallId: null,
        scope: threadScope(),
        sequence: 1,
        threadId: fork.id,
        type: "system/error",
      },
    ]);
    expect(readThreadForkPoint(db, fork.id)).toEqual({
      sourceThreadId: source.id,
      sourceTurnId: null,
      sourceSequence: null,
    });
    db.$client.close();
  });

  it("is null for a thread that is not a fork or does not exist, through bb.experimental_hooks as well", async () => {
    const db = createMigratedConnection();
    const { source } = seed(db);
    const api = forkPluginHooks({
      pluginId: "studio",
      assertLive: () => {},
      disposeHooks: [],
      db,
    });
    expect(readThreadForkPoint(db, source.id)).toBeNull();
    await expect(
      api.experimental_threadForkPoint("thr_missing"),
    ).resolves.toBeNull();
    await expect(api.experimental_threadForkPoint("")).resolves.toBeNull();
    await expect(
      api.experimental_threadForkPoint(source.id),
    ).resolves.toBeNull();
    db.$client.close();
  });
});
