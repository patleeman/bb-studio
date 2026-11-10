import {
  getThread,
  listQueuedThreadMessages,
  setAppUpdateSendHold,
} from "@bb/db";
import { threadResponseSchema } from "@bb/server-contract";
import { afterEach, describe, expect, it } from "vitest";
import {
  invokePluginInline,
  setPluginHookProvider,
} from "../../src/services/plugins/plugin-hook-registry.js";
import { toThreadQueuedMessage } from "../../src/services/threads/thread-queued-messages.js";
import {
  listQueuedThreadCommands,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const PATH = "/tmp/turnless-dispatch";

afterEach(() => {
  setPluginHookProvider(undefined);
});

function fillConcurrency(): { asked: number } {
  const calls = { asked: 0 };
  setPluginHookProvider({
    listHooks: () => [
      {
        pluginId: "concurrency-limit",
        handler: () => {
          calls.asked += 1;
          return { action: "wait", reason: "at capacity" } as const;
        },
      },
    ],
    invokeHook: (_pluginId, _label, run) => invokePluginInline(run),
    decisionTimeoutMs: 10_000,
  });
  return calls;
}

function seedSource(harness: TestAppHarness) {
  const { host } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: PATH,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: PATH,
  });
  const source = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
  });
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    permissionMode: "full",
    providerThreadId: "provider-turnless-dispatch",
    threadId: source.id,
  });
  seedTurnStarted(harness.deps, {
    environmentId: environment.id,
    providerThreadId: "provider-turnless-dispatch",
    sequence: 3,
    threadId: source.id,
    turnId: "turn-turnless-dispatch",
  });
  return { source };
}

async function fork(harness: TestAppHarness, body: Record<string, unknown>) {
  const response = await harness.app.request("/api/v1/threads/fork", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(201);
  return threadResponseSchema.parse(await readJson(response));
}

function queued(harness: TestAppHarness, threadId: string) {
  return listQueuedThreadMessages(harness.db, threadId).map(
    toThreadQueuedMessage,
  );
}

function texts(entry: { content: { type: string; text?: string }[] }) {
  return entry.content.flatMap((block) =>
    block.type === "text" && block.text !== undefined ? [block.text] : [],
  );
}

describe("a fork while the concurrency limit is full", () => {
  it("creates an empty-input fork as an idle fork with no queued message", async () => {
    await withTestHarness(async (harness) => {
      const { source } = seedSource(harness);
      const limiter = fillConcurrency();

      const created = await fork(harness, {
        sourceThreadId: source.id,
        visibility: "visible",
      });

      expect(limiter.asked).toBe(0);
      expect(queued(harness, created.id)).toEqual([]);
      const start = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === created.id,
      );
      if (start.command.type !== "thread.start") {
        throw new Error("expected thread.start");
      }
      expect(start.command.input).toEqual([]);
      expect(start.command.fork).not.toBeNull();
      await reportQueuedCommandSuccess(harness, start, {
        providerThreadId: "provider-turnless-fork",
      });
      expect(getThread(harness.db, created.id)?.status).toBe("idle");

      const response = await harness.app.request(
        `/api/v1/threads/${created.id}`,
      );
      expect(response.status).toBe(200);
    });
  });

  it("queues the input of a fork that has one", async () => {
    await withTestHarness(async (harness) => {
      const { source } = seedSource(harness);
      const limiter = fillConcurrency();

      const created = await fork(harness, {
        sourceThreadId: source.id,
        visibility: "visible",
        input: textInput("Carry on from here"),
      });

      expect(limiter.asked).toBe(1);
      const rows = queued(harness, created.id);
      expect(rows).toHaveLength(1);
      expect(texts(rows[0]!)).toEqual(["Carry on from here"]);
      expect(rows[0]!.waitingOn).toEqual({
        kind: "plugin",
        pluginId: "concurrency-limit",
        reason: "at capacity",
      });
      expect(getThread(harness.db, created.id)?.status).toBe("pending");
      expect(
        listQueuedThreadCommands(harness, "thread.start", created.id),
      ).toEqual([]);
    });
  });

  it("queues no empty message when a core wait holds an empty-input fork", async () => {
    await withTestHarness(async (harness) => {
      const { source } = seedSource(harness);
      setAppUpdateSendHold(harness.db, true);

      const created = await fork(harness, {
        sourceThreadId: source.id,
        visibility: "visible",
      });

      expect(queued(harness, created.id)).toEqual([]);
      expect(getThread(harness.db, created.id)?.status).toBe("pending");
      const response = await harness.app.request(
        `/api/v1/threads/${created.id}`,
      );
      expect(response.status).toBe(200);
    });
  });
});
