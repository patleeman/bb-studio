import { getThread } from "@bb/db";
import { threadScope, turnScope } from "@bb/domain";
import { afterEach, describe, expect, it } from "vitest";
import {
  announceThreadFilesChanged,
  announceTurnInterrupted,
  emitPluginHostConnected,
  emitPluginHostDisconnected,
  noteDaemonInstance,
  registerForkPluginEvents,
} from "../../../src/services/plugins/fork-plugin-events.js";
import {
  seedEvent,
  seedHost,
  seedThread,
  seedThreadFixture,
} from "../../helpers/seed.js";
import {
  withTestHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

type Emitted = { event: string; payload: unknown };

function wire(harness: TestAppHarness): Emitted[] {
  const emitted: Emitted[] = [];
  registerForkPluginEvents({
    emit: (event, build) => {
      const payload = build();
      if (payload !== null) emitted.push({ event, payload });
    },
    db: harness.db,
    buildThreadDto: (thread) => ({ id: thread.id }) as never,
    toHostRecord: (host, status) => ({ id: host.id, status }) as never,
  });
  return emitted;
}

function seedIdleThread(harness: TestAppHarness) {
  const { project, environment } = seedThreadFixture(harness);
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status: "idle",
  });
  return { thread, environment };
}

function applied(harness: TestAppHarness, threadId: string) {
  const thread = getThread(harness.db, threadId);
  if (thread === null) throw new Error("thread missing");
  return { applied: true as const, thread };
}

afterEach(() => {
  registerForkPluginEvents({
    emit: () => {},
    db: null as never,
    buildThreadDto: () => null as never,
    toHostRecord: () => null as never,
  });
});

describe("fork plugin events", () => {
  it("says a stopped turn was interrupted, with the recorded reason", async () => {
    await withTestHarness(async (harness) => {
      const emitted = wire(harness);
      const { thread, environment } = seedIdleThread(harness);
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-1",
        scope: threadScope(),
        sequence: 1,
        type: "system/thread/interrupted",
        data: { reason: "manual-stop" },
      });

      announceTurnInterrupted(
        { threadId: thread.id, event: { type: "stop.settled" } },
        applied(harness, thread.id),
        "stopping",
      );

      expect(emitted).toEqual([
        {
          event: "experimental_turn.interrupted",
          payload: { thread: { id: thread.id }, reason: "manual-stop" },
        },
      ]);
    });
  });

  it("stays silent for an ordinary failure and for a turn that finished", async () => {
    await withTestHarness(async (harness) => {
      const emitted = wire(harness);
      const { thread } = seedIdleThread(harness);

      announceTurnInterrupted(
        { threadId: thread.id, event: { type: "run.failed" } },
        applied(harness, thread.id),
        "active",
      );
      announceTurnInterrupted(
        { threadId: thread.id, event: { type: "run.succeeded" } },
        applied(harness, thread.id),
        "active",
      );
      announceTurnInterrupted(
        { threadId: thread.id, event: { type: "stop.settled" } },
        applied(harness, thread.id),
        "idle",
      );

      expect(emitted).toEqual([]);
    });
  });

  it("reports a host daemon connecting, restarted or not, and going away", async () => {
    await withTestHarness(async (harness) => {
      const emitted = wire(harness);
      const host = seedHost(harness.deps, { id: "host_events" });

      noteDaemonInstance(host.id, true);
      emitPluginHostConnected(host.id);
      noteDaemonInstance(host.id, false);
      emitPluginHostConnected(host.id);
      emitPluginHostDisconnected(host.id, "expired");
      emitPluginHostConnected("host_unknown");

      expect(emitted).toEqual([
        {
          event: "experimental_host.connected",
          payload: {
            host: { id: host.id, status: "connected" },
            restarted: false,
          },
        },
        {
          event: "experimental_host.connected",
          payload: {
            host: { id: host.id, status: "connected" },
            restarted: true,
          },
        },
        {
          event: "experimental_host.disconnected",
          payload: {
            host: { id: host.id, status: "disconnected" },
            reason: "expired",
          },
        },
      ]);
    });
  });

  it("reports the files an agent changed once, in order, and skips old history the first time", async () => {
    await withTestHarness(async (harness) => {
      const emitted = wire(harness);
      const { thread, environment } = seedIdleThread(harness);
      const change = (sequence: number, path: string, createdAt: number) =>
        seedEvent(harness.deps, {
          threadId: thread.id,
          environmentId: environment.id,
          providerThreadId: "provider-1",
          scope: turnScope("turn-1"),
          sequence,
          type: "item/completed",
          createdAt,
          data: {
            item: {
              type: "fileChange",
              id: `item-${String(sequence)}`,
              changes: [{ path, kind: "update" }],
              status: "completed",
              approvalStatus: null,
            },
          },
        });
      change(1, "/repo/old.ts", Date.now() - 60 * 60_000);
      change(2, "/repo/a.ts", Date.now());

      announceThreadFilesChanged(thread.id);
      announceThreadFilesChanged(thread.id);
      change(3, "/repo/b.ts", Date.now());
      announceThreadFilesChanged(thread.id);

      expect(
        emitted.map((each) =>
          (each.payload as { changes: { path: string }[] }).changes.map(
            (file) => file.path,
          ),
        ),
      ).toEqual([["/repo/a.ts"], ["/repo/b.ts"]]);
    });
  });
});
