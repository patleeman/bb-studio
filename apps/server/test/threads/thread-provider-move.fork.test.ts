import {
  createStandaloneBuiltinCompactCommandInput,
  encodeClientTurnRequestIdNumber,
  THREAD_SESSION_OPTION_SELECTIONS_STATE_KIND,
  threadScope,
  turnScope,
} from "@bb/domain";
import { eq } from "drizzle-orm";
import * as executionOptions from "../../src/services/system/execution-options.js";
import { resolvePendingThreadSessionOptions } from "../../src/services/threads/thread-session-options.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getLastStoredProviderThreadId,
  getThread,
  getThreadExecutionOverride,
  getLatestThreadSequence,
  listStoredEventRows,
  threads,
} from "@bb/db";
import {
  PROVIDER_MOVE_OPERATION,
  getLatestProviderMove,
  getPendingProviderMove,
  inheritedExecutionAfterProviderMove,
  providerMoveState,
  registerProviderMoveDb,
} from "../../src/services/threads/provider-move-state.fork.js";
import { getLastExecutionOptions } from "../../src/services/threads/thread-events.js";
import { forkPluginHooks } from "../../src/services/threads/turn-classifiers.fork.js";
import { retryTurnAfterRestart } from "../../src/services/threads/turn-retry.js";
import { resolveExistingThreadExecutionPlan } from "../../src/services/threads/thread-execution-plan.js";
import { resolveMovePermissionMode } from "../../src/services/threads/thread-provider-move.fork.js";
import {
  collectTurnContext,
  pendingTurnContextMove,
  registerTurnContextProvider,
  startsTurnForTurnContext,
  TURN_CONTEXT_MAX_CHARS,
  withTurnContext,
} from "../../src/services/threads/turn-context.fork.js";
import {
  EMPTY_WORKSPACE_AGENT_CONTEXT,
  registerHostRpcResponder,
  type HostRpcHandlerResult,
} from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedEvent,
  seedQueuedMessage,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const TARGET = "acp-cursor";
const TARGET_MODEL = "gpt-5.3-codex";
const disposers: Array<() => void> = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dispose of disposers.splice(0)) dispose();
  registerProviderMoveDb(null);
});

function catalogModel(model: string, isDefault = true) {
  return {
    id: model,
    model,
    displayName: model,
    description: "",
    reasoningDiscovery: "known" as const,
    supportedReasoningEfforts: [
      { reasoningEffort: "low" as const, description: "" },
      { reasoningEffort: "high" as const, description: "" },
    ],
    defaultReasoningEffort: "high" as const,
    isDefault,
  };
}

function seedFixture(
  harness: TestAppHarness,
  status: "idle" | "active" | "error" = "idle",
  permissionMode: "auto" | "accept-edits" | "full" = "full",
  handler = true,
) {
  registerProviderMoveDb(harness.db);
  if (handler) {
    disposers.push(
      registerTurnContextProvider(
        "handoff",
        ({ providerMove }) => (providerMove ? "HISTORY" : null),
        { providerMove: true },
      ),
    );
  }
  const { host, session } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
  });
  const thread = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
    providerId: "codex",
    status,
  });
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    providerThreadId: "provider-before-move",
    threadId: thread.id,
    permissionMode,
  });
  const responder = registerHostRpcResponder(harness, {
    hostId: host.id,
    sessionId: session.id,
    handle: async ({ command }): Promise<HostRpcHandlerResult> => {
      switch (command.type) {
        case "provider.list_models":
          return {
            ok: true,
            result:
              command.providerId === TARGET
                ? {
                    models: [catalogModel(TARGET_MODEL)],
                    selectedOnlyModels: [],
                  }
                : command.providerId === "codex"
                  ? {
                      models: [catalogModel("gpt-moved")],
                      selectedOnlyModels: [],
                    }
                  : { models: [], selectedOnlyModels: [] },
          };
        case "thread.stop":
          return { ok: true, result: { providerCheckpointId: null } };
        case "thread.start":
          return {
            ok: true,
            result: { providerThreadId: "provider-after-move" },
          };
        case "host.read_workspace_agent_context":
          return { ok: true, result: EMPTY_WORKSPACE_AGENT_CONTEXT };
        default:
          throw new Error(`Unexpected command: ${command.type}`);
      }
    },
  });
  return { environment, host, responder, thread };
}

function seedRequest(
  harness: TestAppHarness,
  environmentId: string,
  threadId: string,
  text: string,
  initiator: "user" | "agent" = "user",
): { sequence: number; requestId: string } {
  const sequence = getLatestThreadSequence(harness.db, { threadId }) + 1;
  const requestId = encodeClientTurnRequestIdNumber({ value: sequence });
  seedEvent(harness.deps, {
    threadId,
    environmentId,
    sequence,
    type: "client/turn/requested",
    scope: threadScope(),
    data: {
      direction: "outbound",
      requestId,
      input: [{ type: "text", text, mentions: [] }],
      target: { kind: "new-turn" },
      execution: {
        model: TARGET_MODEL,
        serviceTier: "default",
        reasoningLevel: "high",
        permissionMode: "accept-edits",
        source: "client/turn/requested",
      },
      initiator,
      senderThreadId: initiator === "agent" ? "thr_sender" : null,
      request: { method: "turn/start", params: {} },
      source: "tell",
    },
  });
  return { sequence, requestId };
}

function acceptRequest(
  harness: TestAppHarness,
  environmentId: string,
  threadId: string,
  turnId: string,
  requestId: string,
) {
  seedEvent(harness.deps, {
    threadId,
    environmentId,
    providerThreadId: `provider-${turnId}`,
    sequence: getLatestThreadSequence(harness.db, { threadId }) + 1,
    type: "turn/input/accepted",
    scope: turnScope(turnId),
    data: {
      providerThreadId: `provider-${turnId}`,
      clientRequestId: requestId,
    },
  });
}

/** A real request the provider accepted, in a turn that completed. */
function startTurnAfterMove(
  harness: TestAppHarness,
  environmentId: string,
  threadId: string,
  text: string,
  initiator: "user" | "agent" = "user",
  providerCheckpointId?: string,
): { sequence: number; requestId: string } {
  const request = seedRequest(
    harness,
    environmentId,
    threadId,
    text,
    initiator,
  );
  seedTurnStarted(harness.deps, {
    environmentId,
    threadId,
    turnId: `turn-${text}`,
    providerThreadId: `provider-turn-${text}`,
  });
  acceptRequest(
    harness,
    environmentId,
    threadId,
    `turn-${text}`,
    request.requestId,
  );
  completeTurn(
    harness,
    environmentId,
    threadId,
    `turn-${text}`,
    "completed",
    providerCheckpointId,
  );
  return request;
}

function completeTurn(
  harness: TestAppHarness,
  environmentId: string,
  threadId: string,
  turnId: string,
  status: "completed" | "failed" | "interrupted",
  providerCheckpointId?: string,
) {
  seedEvent(harness.deps, {
    threadId,
    environmentId,
    providerThreadId: `provider-${turnId}`,
    sequence: getLatestThreadSequence(harness.db, { threadId }) + 1,
    type: "turn/completed",
    scope: turnScope(turnId),
    data: {
      providerThreadId: `provider-${turnId}`,
      status,
      ...(providerCheckpointId === undefined ? {} : { providerCheckpointId }),
    },
  });
}

function move(harness: TestAppHarness, threadId: string, body: unknown) {
  return harness.app.request(`/api/v1/threads/${threadId}/move-provider`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function moveEvents(harness: TestAppHarness, threadId: string) {
  return listStoredEventRows(harness.db, { threadId }).filter(
    (row) =>
      row.type === "system/operation" &&
      JSON.parse(row.data).operation === PROVIDER_MOVE_OPERATION,
  );
}

describe("POST /threads/:id/move-provider", () => {
  it("moves an idle thread: swaps provider and model, drops the session, records the move", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedFixture(harness);
      const response = await move(harness, thread.id, {
        providerId: TARGET,
        model: TARGET_MODEL,
        historyTokens: 1000,
      });
      const body = (await readJson(response)) as Record<string, unknown>;
      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        status: "moved",
        from: { providerId: "codex" },
        to: { providerId: TARGET, model: TARGET_MODEL },
        historyTokens: 1000,
      });
      expect(getThread(harness.db, thread.id)?.providerId).toBe(TARGET);
      expect(getThreadExecutionOverride(harness.db, thread.id)).toEqual({
        modelOverride: TARGET_MODEL,
        reasoningLevelOverride: "high",
      });
      expect(getLastStoredProviderThreadId(harness.db, thread.id)).toBeNull();
      const events = moveEvents(harness, thread.id);
      expect(events).toHaveLength(1);
      const stored = getLatestProviderMove(harness.db, thread.id);
      expect(stored).toMatchObject({
        from: { providerId: "codex" },
        to: { providerId: TARGET, model: TARGET_MODEL },
        historyTokens: 1000,
        by: "api",
      });
      expect(stored?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      // The move is in the same transaction as the swap, before the clear.
      const clear = listStoredEventRows(harness.db, {
        threadId: thread.id,
      }).find(
        (row) =>
          row.type === "system/operation" &&
          JSON.parse(row.data).operation !== PROVIDER_MOVE_OPERATION,
      );
      expect(clear?.sequence).toBe((events[0]?.sequence ?? 0) + 1);
      // The next turn inherits the move's permission, not the old provider's.
      expect(
        inheritedExecutionAfterProviderMove(harness.db, thread.id, null),
      ).toMatchObject({
        model: TARGET_MODEL,
        permissionMode:
          body.to && (body.to as { permissionMode: string }).permissionMode,
      });
    });
  });

  it("is idempotent: a second run reports already-moved and writes nothing", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedFixture(harness);
      const request = { providerId: TARGET, model: TARGET_MODEL };
      expect((await move(harness, thread.id, request)).status).toBe(200);
      const again = await move(harness, thread.id, request);
      expect(again.status).toBe(200);
      expect(await readJson(again)).toMatchObject({ status: "already-moved" });
      expect(moveEvents(harness, thread.id)).toHaveLength(1);
    });
  });

  it("dry run returns would-move and writes nothing", async () => {
    await withTestHarness(async (harness) => {
      const { thread, responder } = seedFixture(harness);
      const before = listStoredEventRows(harness.db, { threadId: thread.id });
      const response = await move(harness, thread.id, {
        providerId: TARGET,
        model: TARGET_MODEL,
        dryRun: true,
      });
      expect(response.status).toBe(200);
      expect(await readJson(response)).toMatchObject({
        status: "would-move",
        to: { providerId: TARGET, model: TARGET_MODEL },
      });
      expect(getThread(harness.db, thread.id)?.providerId).toBe("codex");
      expect(
        listStoredEventRows(harness.db, { threadId: thread.id }),
      ).toHaveLength(before.length);
      expect(getLastStoredProviderThreadId(harness.db, thread.id)).toBe(
        "provider-before-move",
      );
      expect(
        responder.requests.some(
          ({ command }) => command.type === "thread.stop",
        ),
      ).toBe(false);
    });
  });

  it("refuses a busy thread with 409 thread_busy", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedFixture(harness, "active");
      const response = await move(harness, thread.id, {
        providerId: TARGET,
        model: TARGET_MODEL,
      });
      expect(response.status).toBe(409);
      expect(await readJson(response)).toMatchObject({
        code: "thread_busy",
        details: { reason: "running" },
      });
      expect(getThread(harness.db, thread.id)?.providerId).toBe("codex");
    });
  });

  it("refuses a thread with queued messages with 409 thread_busy", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedFixture(harness);
      seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: textInput("Queued follow-up"),
      });
      const response = await move(harness, thread.id, {
        providerId: TARGET,
        model: TARGET_MODEL,
      });
      expect(response.status).toBe(409);
      expect(await readJson(response)).toMatchObject({
        code: "thread_busy",
        details: { reason: "queued-messages" },
      });
    });
  });

  it("refuses an unknown provider with 422 provider_unavailable", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedFixture(harness);
      const response = await move(harness, thread.id, {
        providerId: "no-such-provider",
        model: "x",
      });
      expect(response.status).toBe(422);
      expect(await readJson(response)).toMatchObject({
        code: "provider_unavailable",
      });
      expect(moveEvents(harness, thread.id)).toHaveLength(0);
    });
  });

  it("refuses a model outside the target catalog with 422 model_unavailable", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedFixture(harness);
      const response = await move(harness, thread.id, {
        providerId: TARGET,
        model: "not-in-catalog",
      });
      expect(response.status).toBe(422);
      expect(await readJson(response)).toMatchObject({
        code: "model_unavailable",
      });
      expect(getThread(harness.db, thread.id)?.providerId).toBe("codex");
    });
  });

  it("uses the target's default model when none is named", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedFixture(harness);
      const response = await move(harness, thread.id, {
        providerId: TARGET,
        dryRun: true,
      });
      expect(await readJson(response)).toMatchObject({
        status: "would-move",
        to: { model: TARGET_MODEL },
      });
    });
  });

  it("lowers auto to what the target supports and never widens an explicit request", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedFixture(harness, "idle", "auto");
      const dry = await move(harness, thread.id, {
        providerId: TARGET,
        model: TARGET_MODEL,
        dryRun: true,
      });
      expect(await readJson(dry)).toMatchObject({
        from: { permissionMode: "auto" },
        to: { permissionMode: "accept-edits" },
      });

      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-before-move",
        threadId: thread.id,
        permissionMode: "accept-edits",
        sequenceStart: 10,
      });
      const wider = await move(harness, thread.id, {
        providerId: TARGET,
        model: TARGET_MODEL,
        permissionMode: "auto",
      });
      expect(wider.status).toBe(422);
      expect(await readJson(wider)).toMatchObject({
        code: "permission_widening",
      });

      const full = await move(harness, thread.id, {
        providerId: TARGET,
        model: TARGET_MODEL,
        permissionMode: "full",
      });
      expect(full.status).toBe(200);
      expect(await readJson(full)).toMatchObject({
        status: "moved",
        from: { permissionMode: "accept-edits" },
        to: { permissionMode: "full" },
      });
    });
  });
});

describe("the next turn after a move", () => {
  it("inherits the move's model and lowered permission, not the old provider's auto", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedFixture(harness, "idle", "auto");
      expect(
        (
          await move(harness, thread.id, {
            providerId: TARGET,
            model: TARGET_MODEL,
          })
        ).status,
      ).toBe(200);
      const plan = await resolveExistingThreadExecutionPlan(harness.deps, {
        executionSource: "client/turn/requested",
        input: {},
        threadId: thread.id,
      });
      expect(plan.resolvedExecution).toMatchObject({
        model: TARGET_MODEL,
        permissionMode: "accept-edits",
        reasoningLevel: "high",
      });
    });
  });
});

describe("dispatch after a move", () => {
  it("starts a new session on the target with the move's execution and providerMove context", async () => {
    await withTestHarness(async (harness) => {
      const { responder, thread } = seedFixture(harness, "idle", "auto");
      disposers.push(
        registerTurnContextProvider(
          "studio",
          ({ providerMove }) =>
            providerMove
              ? `HANDOFF from ${providerMove.from.providerId} (${String(providerMove.historyTokens)})`
              : null,
          { providerMove: true },
        ),
      );
      expect(
        (
          await move(harness, thread.id, {
            providerId: TARGET,
            model: TARGET_MODEL,
            historyTokens: 1234,
          })
        ).status,
      ).toBe(200);
      const sent = await harness.app.request(
        `/api/v1/threads/${thread.id}/send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "start", input: textInput("hello") }),
        },
      );
      expect(sent.status).toBe(200);
      await vi.waitFor(() => {
        expect(
          responder.requests.filter(
            ({ command }) => command.type === "thread.start",
          ),
        ).toHaveLength(1);
      });
      expect(
        responder.requests.filter(
          ({ command }) => command.type === "turn.submit",
        ),
      ).toEqual([]);
      const start = responder.requests.find(
        ({ command }) => command.type === "thread.start",
      )?.command as unknown as {
        providerId: string;
        options: Record<string, unknown>;
        input: Array<{ type: string; text?: string }>;
      };
      expect(start.providerId).toBe(TARGET);
      expect(start.options).toMatchObject({
        model: TARGET_MODEL,
        permissionMode: "accept-edits",
        reasoningLevel: "high",
      });
      // History first, then the user's message.
      const texts = start.input.map((item) => item.text ?? "");
      expect(texts.at(-1)).toBe("hello");
      expect(texts.slice(0, -1).join("\n")).toContain(
        "HANDOFF from codex (1234)",
      );
    });
  });
});

describe("move status and selection routes", () => {
  it("selects threads by provider and reports pending then rebuilt", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedFixture(harness);
      const selected = (await readJson(
        await harness.app.request(
          `/api/v1/fork/provider-move/threads?from=codex&projectId=${thread.projectId}`,
        ),
      )) as { threads: Array<{ id: string }> };
      expect(selected.threads.map((row) => row.id)).toEqual([thread.id]);

      const none = (await readJson(
        await harness.app.request(`/api/v1/fork/provider-move/status`),
      )) as { threads: unknown[] };
      expect(none.threads).toEqual([]);

      await move(harness, thread.id, {
        providerId: TARGET,
        model: TARGET_MODEL,
      });
      const pending = (await readJson(
        await harness.app.request(`/api/v1/fork/provider-move/status`),
      )) as { threads: Array<{ threadId: string; state: string }> };
      expect(pending.threads).toEqual([
        expect.objectContaining({ threadId: thread.id, state: "pending" }),
      ]);
      const afterMove = (await readJson(
        await harness.app.request(
          `/api/v1/fork/provider-move/threads?from=codex`,
        ),
      )) as { threads: unknown[] };
      expect(afterMove.threads).toEqual([]);

      startTurnAfterMove(harness, environment.id, thread.id, "hello");
      expect(
        await readJson(
          await harness.app.request(
            `/api/v1/threads/${thread.id}/move-provider`,
          ),
        ),
      ).toMatchObject({
        threadId: thread.id,
        state: "rebuilt",
        move: { to: { providerId: TARGET, model: TARGET_MODEL } },
      });
    });
  });
});

describe("what counts as the first turn after a move", () => {
  it("a bare /compact first does not use up the move", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedFixture(harness);
      await move(harness, thread.id, {
        providerId: TARGET,
        model: TARGET_MODEL,
      });
      const compactId = encodeClientTurnRequestIdNumber({ value: 99 });
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence:
          getLatestThreadSequence(harness.db, { threadId: thread.id }) + 1,
        type: "client/turn/requested",
        scope: threadScope(),
        data: {
          direction: "outbound",
          requestId: compactId,
          input: createStandaloneBuiltinCompactCommandInput(),
          target: { kind: "new-turn" },
          execution: {
            model: TARGET_MODEL,
            serviceTier: "default",
            reasoningLevel: "high",
            permissionMode: "accept-edits",
            source: "client/turn/requested",
          },
          initiator: "user",
          senderThreadId: null,
          request: { method: "turn/start", params: {} },
          source: "tell",
        },
      });
      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        threadId: thread.id,
        turnId: "turn-compact",
      });
      acceptRequest(
        harness,
        environment.id,
        thread.id,
        "turn-compact",
        compactId,
      );
      completeTurn(
        harness,
        environment.id,
        thread.id,
        "turn-compact",
        "completed",
      );
      expect(getPendingProviderMove(harness.db, thread.id)).not.toBeNull();
    });
  });

  it("stays pending through a failed dispatch and a turn the provider never accepted", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedFixture(harness);
      await move(harness, thread.id, {
        providerId: TARGET,
        model: TARGET_MODEL,
      });
      // Dispatch failed: a request with no turn.
      seedRequest(harness, environment.id, thread.id, "real question");
      expect(getPendingProviderMove(harness.db, thread.id)).not.toBeNull();
      // A turn started and failed before the provider accepted the input
      // (an oversized first prompt).
      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        threadId: thread.id,
        turnId: "turn-rejected",
      });
      completeTurn(
        harness,
        environment.id,
        thread.id,
        "turn-rejected",
        "failed",
      );
      expect(getPendingProviderMove(harness.db, thread.id)).not.toBeNull();
      // A later bare /compact can't mark it rebuilt either (tested above).
      startTurnAfterMove(harness, environment.id, thread.id, "retry");
      expect(getPendingProviderMove(harness.db, thread.id)).toBeNull();
    });
  });

  it("an accepted but interrupted first turn is not sent the history again", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedFixture(harness);
      await move(harness, thread.id, {
        providerId: TARGET,
        model: TARGET_MODEL,
      });
      const request = seedRequest(harness, environment.id, thread.id, "first");
      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        threadId: thread.id,
        turnId: "turn-first",
      });
      acceptRequest(
        harness,
        environment.id,
        thread.id,
        "turn-first",
        request.requestId,
      );
      completeTurn(
        harness,
        environment.id,
        thread.id,
        "turn-first",
        "interrupted",
      );
      expect(getPendingProviderMove(harness.db, thread.id)).toBeNull();
      expect(
        await readJson(
          await harness.app.request(
            `/api/v1/threads/${thread.id}/move-provider`,
          ),
        ),
      ).toMatchObject({ state: "rebuilt", move: { handoff: "required" } });
    });
  });

  it("a context clear after the move cancels the history rebuild", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedFixture(harness);
      await move(harness, thread.id, {
        providerId: TARGET,
        model: TARGET_MODEL,
      });
      expect(getPendingProviderMove(harness.db, thread.id)).not.toBeNull();
      const cleared = await harness.app.request(
        `/api/v1/threads/${thread.id}/context/clear`,
        { method: "POST" },
      );
      expect(cleared.status).toBe(200);
      expect(getPendingProviderMove(harness.db, thread.id)).toBeNull();
      expect(
        await readJson(
          await harness.app.request(
            `/api/v1/threads/${thread.id}/move-provider`,
          ),
        ),
      ).toMatchObject({ state: "cleared" });
    });
  });

  it("forks and children read the move's execution, not the old provider's", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedFixture(harness, "idle", "full");
      await move(harness, thread.id, {
        providerId: TARGET,
        model: TARGET_MODEL,
        permissionMode: "accept-edits",
      });
      expect(getLastExecutionOptions(harness.deps, thread.id)).toMatchObject({
        model: TARGET_MODEL,
        permissionMode: "accept-edits",
        reasoningLevel: "high",
      });
    });
  });
});

describe("bb.experimental_hooks.experimental_moveThreadProvider", () => {
  function hooks(harness: TestAppHarness) {
    return forkPluginHooks({
      pluginId: "studio",
      assertLive: () => {},
      disposeHooks: [],
      db: harness.db,
    });
  }

  it("moves in process, with the route's result and refusals as a union", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedFixture(harness);
      const bb = hooks(harness);
      expect(bb.experimental_features.providerMove).toBe(true);

      expect(
        await bb.experimental_moveThreadProvider(thread.id, {
          providerId: TARGET,
          model: "not-in-catalog",
        }),
      ).toMatchObject({
        ok: false,
        httpStatus: 422,
        code: "model_unavailable",
      });
      expect(
        await bb.experimental_moveThreadProvider(thread.id, {
          providerId: TARGET,
          historyTokens: -1,
        }),
      ).toMatchObject({ ok: false, httpStatus: 400, code: "invalid_request" });
      expect(
        await bb.experimental_moveThreadProvider("thr_missing", {
          providerId: TARGET,
        }),
      ).toMatchObject({ ok: false, httpStatus: 404 });

      const moved = await bb.experimental_moveThreadProvider(thread.id, {
        providerId: TARGET,
        model: TARGET_MODEL,
      });
      expect(moved).toMatchObject({
        ok: true,
        status: "moved",
        to: { providerId: TARGET, model: TARGET_MODEL },
      });
      expect(getLatestProviderMove(harness.db, thread.id)?.by).toBe(
        "plugin:studio",
      );
      expect(
        await bb.experimental_moveThreadProvider(thread.id, {
          providerId: TARGET,
          model: TARGET_MODEL,
        }),
      ).toMatchObject({ ok: true, status: "already-moved" });
    });
  });

  it("returns thread_busy with the reason for a busy thread", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedFixture(harness, "active");
      expect(
        await hooks(harness).experimental_moveThreadProvider(thread.id, {
          providerId: TARGET,
          model: TARGET_MODEL,
        }),
      ).toEqual({
        ok: false,
        threadId: thread.id,
        httpStatus: 409,
        code: "thread_busy",
        message: expect.any(String),
        reason: "running",
      });
    });
  });
});

describe("move permission", () => {
  const acp = ["accept-edits", "full"] as const;
  it("never widens without an explicit full", () => {
    expect(
      resolveMovePermissionMode({
        current: "auto",
        requested: undefined,
        supported: acp,
        ceiling: "full",
      }),
    ).toBe("accept-edits");
    expect(
      resolveMovePermissionMode({
        current: "full",
        requested: undefined,
        supported: acp,
        ceiling: "full",
      }),
    ).toBe("full");
    expect(
      resolveMovePermissionMode({
        current: "accept-edits",
        requested: undefined,
        supported: acp,
        ceiling: "full",
      }),
    ).toBe("accept-edits");
    expect(
      resolveMovePermissionMode({
        current: "full",
        requested: undefined,
        supported: acp,
        ceiling: "accept-edits",
      }),
    ).toBe("accept-edits");
  });

  it("refuses widening requests and unsupported modes", () => {
    expect(() =>
      resolveMovePermissionMode({
        current: "accept-edits",
        requested: "auto",
        supported: null,
        ceiling: "full",
      }),
    ).toThrow(/wider/);
    expect(() =>
      resolveMovePermissionMode({
        current: "auto",
        requested: "auto",
        supported: acp,
        ceiling: "full",
      }),
    ).toThrow(/supports/);
    expect(() =>
      resolveMovePermissionMode({
        current: "accept-edits",
        requested: undefined,
        supported: ["full"],
        ceiling: "full",
      }),
    ).toThrow(/explicitly/);
  });

  it("allows an explicit full", () => {
    expect(
      resolveMovePermissionMode({
        current: "accept-edits",
        requested: "full",
        supported: acp,
        ceiling: "full",
      }),
    ).toBe("full");
  });
});

describe("turn context after a move", () => {
  it("hands providerMove to plugins only until the first turn starts, with a large budget", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedFixture(harness);
      const seen: unknown[] = [];
      disposers.push(
        registerTurnContextProvider(
          "studio",
          (context) => {
            seen.push(context.providerMove ?? null);
            return context.providerMove
              ? "h".repeat(TURN_CONTEXT_MAX_CHARS * 3)
              : "short";
          },
          { providerMove: true },
        ),
      );

      expect(pendingTurnContextMove(thread.id)).toBeNull();
      const before = await collectTurnContext(thread.id);
      expect(seen).toEqual([null]);
      expect(before).toHaveLength(1);

      const response = await move(harness, thread.id, {
        providerId: TARGET,
        model: TARGET_MODEL,
        historyTokens: 50_000,
      });
      expect(response.status).toBe(200);

      // First turn (and a retry after a failed dispatch) gets the move.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const prompt = await withTurnContext(thread.id, {
          input: textInput("hello"),
        });
        const added = prompt.input.find(
          (item) =>
            item.type === "text" &&
            item.text.startsWith("Context from the studio plugin"),
        );
        expect(added?.type === "text" ? added.text.length : 0).toBeGreaterThan(
          TURN_CONTEXT_MAX_CHARS * 3,
        );
        expect(prompt.input.at(-1)).toMatchObject({ text: "hello" });
      }
      expect(seen.slice(1)).toEqual([
        expect.objectContaining({
          from: expect.objectContaining({ providerId: "codex" }),
          to: expect.objectContaining({
            providerId: TARGET,
            model: TARGET_MODEL,
          }),
          historyTokens: 50_000,
        }),
        expect.objectContaining({ historyTokens: 50_000 }),
      ]);

      // A steer never carries it.
      const steer = await withTurnContext(
        thread.id,
        { input: textInput("steer") },
        false,
      );
      expect(steer.input).toHaveLength(1);

      startTurnAfterMove(harness, environment.id, thread.id, "hello");
      expect(getPendingProviderMove(harness.db, thread.id)).toBeNull();
      const after = await withTurnContext(thread.id, {
        input: textInput("next"),
      });
      expect(seen.at(-1)).toBeNull();
      const last = after.input.at(-1);
      expect(last?.type === "text" ? last.text : "").toContain("short");
    });
  });
});

describe("review fixes", () => {
  it("refuses with no_handoff_handler when no plugin rebuilds history, unless forced", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedFixture(harness, "idle", "full", false);
      for (const dryRun of [true, false]) {
        const refused = await move(harness, thread.id, {
          providerId: TARGET,
          model: TARGET_MODEL,
          dryRun,
        });
        expect(refused.status).toBe(422);
        expect(await readJson(refused)).toMatchObject({
          code: "no_handoff_handler",
        });
      }
      expect(moveEvents(harness, thread.id)).toHaveLength(0);
      const forced = await move(harness, thread.id, {
        providerId: TARGET,
        model: TARGET_MODEL,
        force: true,
      });
      expect(await readJson(forced)).toMatchObject({
        status: "moved",
        handoff: "none",
      });
      // A forced move's first turn starts without history.
      const prompt = await withTurnContext(thread.id, {
        input: textInput("hello"),
      });
      expect(prompt.input).toHaveLength(1);
    });
  });

  it("fails a move turn whose history no handler delivered, and stays pending", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedFixture(harness, "idle", "full", false);
      disposers.push(
        registerTurnContextProvider("studio", () => null, {
          providerMove: true,
        }),
      );
      await move(harness, thread.id, {
        providerId: TARGET,
        model: TARGET_MODEL,
      });
      await expect(
        withTurnContext(thread.id, { input: textInput("hello") }),
      ).rejects.toMatchObject({ body: { code: "handoff_unavailable" } });
      expect(getPendingProviderMove(harness.db, thread.id)).not.toBeNull();
    });
  });

  it("gives the move budget only to opted-in plugins; others keep 8000 chars after the input", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedFixture(harness);
      const seenByOther: unknown[] = [];
      disposers.push(
        registerTurnContextProvider("zz-other", (context) => {
          seenByOther.push(context.providerMove ?? null);
          return "o".repeat(TURN_CONTEXT_MAX_CHARS * 2);
        }),
      );
      await move(harness, thread.id, {
        providerId: TARGET,
        model: TARGET_MODEL,
      });
      const prompt = await withTurnContext(thread.id, {
        input: textInput("hello"),
      });
      expect(seenByOther).toEqual([null]);
      const texts = prompt.input.map((item) =>
        item.type === "text" ? item.text : "",
      );
      expect(texts[0]).toContain("Context from the handoff plugin");
      expect(texts[1]).toBe("hello");
      expect(texts[2]).toContain("Context from the zz-other plugin");
      expect(texts[2]!.length).toBeLessThan(TURN_CONTEXT_MAX_CHARS + 100);
    });
  });

  it("sets a failed thread to idle so the old turn can't be retried on the new provider", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedFixture(harness, "error");
      expect(
        (
          await move(harness, thread.id, {
            providerId: TARGET,
            model: TARGET_MODEL,
          })
        ).status,
      ).toBe(200);
      expect(getThread(harness.db, thread.id)?.status).toBe("idle");
    });
  });

  it("drops the old provider's session options and selections", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedFixture(harness);
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-before-move",
        sequence:
          getLatestThreadSequence(harness.db, { threadId: thread.id }) + 1,
        type: "thread/extensionState/updated",
        scope: threadScope(),
        data: {
          providerThreadId: "provider-before-move",
          kind: THREAD_SESSION_OPTION_SELECTIONS_STATE_KIND,
          payload: { selections: { mode: "plan" } },
        },
      });
      expect(resolvePendingThreadSessionOptions(harness.db, thread.id)).toEqual(
        { mode: "plan" },
      );
      await move(harness, thread.id, {
        providerId: TARGET,
        model: TARGET_MODEL,
      });
      expect(resolvePendingThreadSessionOptions(harness.db, thread.id)).toEqual(
        {},
      );
    });
  });

  it("refuses a fork point at or before the move", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedFixture(harness);
      await move(harness, thread.id, {
        providerId: TARGET,
        model: TARGET_MODEL,
      });
      const fork = await harness.app.request("/api/v1/threads/fork", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceThreadId: thread.id,
          sourceSeqEnd: 2,
          input: textInput("from before"),
        }),
      });
      expect(fork.status).toBe(409);
      expect(await readJson(fork)).toMatchObject({
        code: "crosses_provider_move",
      });
    });
  });

  it("refuses when the thread changes while the target is being validated", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedFixture(harness);
      const real = executionOptions.resolveSystemExecutionOptionsForValidation;
      vi.spyOn(
        executionOptions,
        "resolveSystemExecutionOptionsForValidation",
      ).mockImplementation(async (...args) => {
        harness.db
          .update(threads)
          .set({ providerId: "claude-code" })
          .where(eq(threads.id, thread.id))
          .run();
        return real(...args);
      });
      const response = await move(harness, thread.id, {
        providerId: TARGET,
        model: TARGET_MODEL,
      });
      expect(response.status).toBe(409);
      expect(await readJson(response)).toMatchObject({
        code: "thread_busy",
        details: { reason: "changed" },
      });
      expect(moveEvents(harness, thread.id)).toHaveLength(0);
      expect(getThread(harness.db, thread.id)?.providerId).toBe("claude-code");
    });
  });

  it("moves an archived thread only with includeArchived, without stopping a runtime", async () => {
    await withTestHarness(async (harness) => {
      const { responder, thread } = seedFixture(harness);
      harness.db
        .update(threads)
        .set({ archivedAt: Date.now() })
        .where(eq(threads.id, thread.id))
        .run();
      const refused = await move(harness, thread.id, {
        providerId: TARGET,
        model: TARGET_MODEL,
      });
      expect(await readJson(refused)).toMatchObject({
        code: "thread_busy",
        details: { reason: "archived" },
      });
      const moved = await move(harness, thread.id, {
        providerId: TARGET,
        model: TARGET_MODEL,
        includeArchived: true,
      });
      expect(await readJson(moved)).toMatchObject({ status: "moved" });
      expect(getThread(harness.db, thread.id)?.providerId).toBe(TARGET);
      expect(getLastStoredProviderThreadId(harness.db, thread.id)).toBeNull();
      expect(moveEvents(harness, thread.id)).toHaveLength(1);
      expect(
        responder.requests.some(
          ({ command }) => command.type === "thread.stop",
        ),
      ).toBe(false);
    });
  });

  it("refuses an archived move when the thread is unarchived meanwhile", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedFixture(harness);
      harness.db
        .update(threads)
        .set({ archivedAt: Date.now() })
        .where(eq(threads.id, thread.id))
        .run();
      const real = executionOptions.resolveSystemExecutionOptionsForValidation;
      vi.spyOn(
        executionOptions,
        "resolveSystemExecutionOptionsForValidation",
      ).mockImplementation(async (...args) => {
        harness.db
          .update(threads)
          .set({ archivedAt: null })
          .where(eq(threads.id, thread.id))
          .run();
        return real(...args);
      });
      const response = await move(harness, thread.id, {
        providerId: TARGET,
        model: TARGET_MODEL,
        includeArchived: true,
      });
      expect(response.status).toBe(409);
      expect(moveEvents(harness, thread.id)).toHaveLength(0);
    });
  });

  it("records the CLI caller's thread as the mover", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedFixture(harness);
      await harness.app.request(`/api/v1/threads/${thread.id}/move-provider`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-bb-cli": "1",
          "x-bb-caller-thread": "thr_caller",
        },
        body: JSON.stringify({ providerId: TARGET, model: TARGET_MODEL }),
      });
      expect(getLatestProviderMove(harness.db, thread.id)?.by).toBe(
        "thread:thr_caller",
      );
    });
  });
});

describe("review 2 fixes", () => {
  function seedPreMoveTurn(
    harness: TestAppHarness,
    environmentId: string,
    threadId: string,
  ) {
    return startTurnAfterMove(
      harness,
      environmentId,
      threadId,
      "pre-move question",
      "user",
      "checkpoint-pre-move",
    );
  }

  async function moveToCodexModel(harness: TestAppHarness, threadId: string) {
    expect(
      (
        await move(harness, threadId, {
          providerId: "codex",
          model: "gpt-moved",
        })
      ).status,
    ).toBe(200);
  }

  function edit(
    harness: TestAppHarness,
    threadId: string,
    expectedRequestSequence?: number,
  ) {
    return harness.app.request(`/api/v1/threads/${threadId}/edit-message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: textInput("rewritten"),
        operationId: `op-${String(expectedRequestSequence ?? "latest")}`,
        ...(expectedRequestSequence === undefined
          ? {}
          : { expectedRequestSequence }),
      }),
    });
  }

  it("an edit with no sequence that resolves to a pre-move turn is refused, and the move record stays", async () => {
    await withTestHarness(async (harness) => {
      const { environment, responder, thread } = seedFixture(harness);
      seedPreMoveTurn(harness, environment.id, thread.id);
      await moveToCodexModel(harness, thread.id);
      // The newest request is an agent's, which an edit skips.
      startTurnAfterMove(
        harness,
        environment.id,
        thread.id,
        "agent note",
        "agent",
      );
      const response = await edit(harness, thread.id);
      expect(await readJson(response)).toMatchObject({
        code: "crosses_provider_move",
      });
      expect(response.status).toBe(409);
      expect(moveEvents(harness, thread.id)).toHaveLength(1);
      expect(
        responder.requests.some(
          ({ command }) => command.type === "thread.rewind.prepare",
        ),
      ).toBe(false);
    });
  });

  it("an edit of the first turn after the move (which would rewind to a pre-move turn) is refused", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedFixture(harness);
      seedPreMoveTurn(harness, environment.id, thread.id);
      await moveToCodexModel(harness, thread.id);
      const first = startTurnAfterMove(
        harness,
        environment.id,
        thread.id,
        "first after",
      );
      const response = await edit(harness, thread.id, first.sequence);
      expect(response.status).toBe(409);
      expect(await readJson(response)).toMatchObject({
        code: "crosses_provider_move",
      });
    });
  });

  it("refuses a fork point after the move whose anchor turn is from before it", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedFixture(harness);
      seedPreMoveTurn(harness, environment.id, thread.id);
      await move(harness, thread.id, {
        providerId: TARGET,
        model: TARGET_MODEL,
      });
      const after = getLatestThreadSequence(harness.db, {
        threadId: thread.id,
      });
      const fork = await harness.app.request("/api/v1/threads/fork", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceThreadId: thread.id,
          sourceSeqEnd: after,
          input: textInput("fork"),
        }),
      });
      expect(fork.status).toBe(409);
      expect(await readJson(fork)).toMatchObject({
        code: "crosses_provider_move",
      });
    });
  });

  it("refuses a restart resume of a request from before the move", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedFixture(harness);
      const request = seedRequest(
        harness,
        environment.id,
        thread.id,
        "old work",
      );
      seedTurnStarted(harness.deps, {
        environmentId: environment.id,
        threadId: thread.id,
        turnId: "turn-old",
      });
      acceptRequest(
        harness,
        environment.id,
        thread.id,
        "turn-old",
        request.requestId,
      );
      completeTurn(
        harness,
        environment.id,
        thread.id,
        "turn-old",
        "interrupted",
      );
      await move(harness, thread.id, {
        providerId: TARGET,
        model: TARGET_MODEL,
      });
      const moved = getThread(harness.db, thread.id)!;
      expect(moved.status).toBe("idle");
      await expect(
        retryTurnAfterRestart(harness.deps, {
          thread: moved,
          request: { sendAt: null },
          continuation: "Continue.",
        } as unknown as Parameters<typeof retryTurnAfterRestart>[1]),
      ).rejects.toMatchObject({ body: { code: "crosses_provider_move" } });
    });
  });

  it("--force on a pending move to the same target waives the history in place", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedFixture(harness, "idle", "full", false);
      disposers.push(
        registerTurnContextProvider("studio", () => null, {
          providerMove: true,
        }),
      );
      await move(harness, thread.id, {
        providerId: TARGET,
        model: TARGET_MODEL,
      });
      const refused = withTurnContext(thread.id, { input: textInput("hello") });
      await expect(refused).rejects.toMatchObject({
        body: { code: "handoff_unavailable" },
      });
      await expect(refused).rejects.toThrow(/--force/);
      const waived = await move(harness, thread.id, {
        providerId: TARGET,
        model: TARGET_MODEL,
        force: true,
      });
      expect(await readJson(waived)).toMatchObject({
        status: "moved",
        handoff: "none",
      });
      const prompt = await withTurnContext(thread.id, {
        input: textInput("hello"),
      });
      expect(prompt.input).toHaveLength(1);
      expect(moveEvents(harness, thread.id)).toHaveLength(2);
    });
  });

  it("a move handler may acknowledge an empty history with an empty string", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedFixture(harness, "idle", "full", false);
      disposers.push(
        registerTurnContextProvider("studio", () => "", { providerMove: true }),
      );
      await move(harness, thread.id, {
        providerId: TARGET,
        model: TARGET_MODEL,
      });
      const prompt = await withTurnContext(thread.id, {
        input: textInput("hello"),
      });
      expect(prompt.input).toHaveLength(1);
    });
  });

  it("status shows the handoff and says started, not rebuilt, for a forced move", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedFixture(
        harness,
        "idle",
        "full",
        false,
      );
      await move(harness, thread.id, {
        providerId: TARGET,
        model: TARGET_MODEL,
        force: true,
      });
      expect(
        await readJson(
          await harness.app.request(
            `/api/v1/threads/${thread.id}/move-provider`,
          ),
        ),
      ).toMatchObject({ state: "pending", move: { handoff: "none" } });
      startTurnAfterMove(harness, environment.id, thread.id, "hello");
      expect(
        await readJson(
          await harness.app.request(
            `/api/v1/threads/${thread.id}/move-provider`,
          ),
        ),
      ).toMatchObject({ state: "started", move: { handoff: "none" } });
    });
  });
});

describe("review 3 fixes", () => {
  it("promotes an auto submit only while a move is pending on a thread that is not active, and asks only move handlers", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedFixture(harness);
      disposers.push(
        registerTurnContextProvider(
          "zz-digest",
          () => "Elsewhere: two workers.",
        ),
      );
      expect(startsTurnForTurnContext(harness.db, thread.id, "auto")).toBe(
        false,
      );
      expect(startsTurnForTurnContext(harness.db, thread.id, "start")).toBe(
        true,
      );
      await move(harness, thread.id, {
        providerId: TARGET,
        model: TARGET_MODEL,
      });
      expect(startsTurnForTurnContext(harness.db, thread.id, "auto")).toBe(
        "move-only",
      );
      expect(startsTurnForTurnContext(harness.db, thread.id, "steer")).toBe(
        false,
      );
      const prompt = await withTurnContext(
        thread.id,
        { input: textInput("again") },
        startsTurnForTurnContext(harness.db, thread.id, "auto"),
      );
      const texts = prompt.input.map((item) =>
        item.type === "text" ? item.text : "",
      );
      expect(texts).toHaveLength(2);
      expect(texts[0]).toContain("Context from the handoff plugin");
      expect(texts[1]).toBe("again");
      // A first turn was just dispatched: active, no turn/started yet.
      harness.db
        .update(threads)
        .set({ status: "active" })
        .where(eq(threads.id, thread.id))
        .run();
      expect(startsTurnForTurnContext(harness.db, thread.id, "auto")).toBe(
        false,
      );
      harness.db
        .update(threads)
        .set({ status: "idle" })
        .where(eq(threads.id, thread.id))
        .run();
      startTurnAfterMove(harness, environment.id, thread.id, "hello");
      expect(startsTurnForTurnContext(harness.db, thread.id, "auto")).toBe(
        false,
      );
    });
  });

  it("keeps a final state once reached", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedFixture(harness);
      await move(harness, thread.id, {
        providerId: TARGET,
        model: TARGET_MODEL,
      });
      startTurnAfterMove(harness, environment.id, thread.id, "hello");
      const latest = getLatestProviderMove(harness.db, thread.id)!;
      expect(providerMoveState(harness.db, thread.id, latest)).toBe("rebuilt");
      // Later requests are not read again for this move.
      for (let index = 0; index < 3; index += 1) {
        seedRequest(
          harness,
          environment.id,
          thread.id,
          `later ${String(index)}`,
        );
      }
      expect(providerMoveState(harness.db, thread.id, latest)).toBe("rebuilt");
    });
  });

  it("the waiver works while a queued message waits on the failed handoff", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedFixture(harness, "idle", "full", false);
      disposers.push(
        registerTurnContextProvider("studio", () => null, {
          providerMove: true,
        }),
      );
      await move(harness, thread.id, {
        providerId: TARGET,
        model: TARGET_MODEL,
      });
      seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: textInput("queued during the outage"),
      });
      // Without the waiver a queued message still blocks a move.
      const blocked = await move(harness, thread.id, {
        providerId: TARGET,
        model: "other-model",
      });
      expect(await readJson(blocked)).toMatchObject({
        details: { reason: "queued-messages" },
      });
      const waived = await move(harness, thread.id, {
        providerId: TARGET,
        model: TARGET_MODEL,
        force: true,
      });
      expect(waived.status).toBe(200);
      expect(await readJson(waived)).toMatchObject({
        status: "moved",
        handoff: "none",
      });
    });
  });

  it("points at the waiver after repeated handoff failures", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedFixture(harness, "idle", "full", false);
      disposers.push(
        registerTurnContextProvider("studio", () => null, {
          providerMove: true,
        }),
      );
      await move(harness, thread.id, {
        providerId: TARGET,
        model: TARGET_MODEL,
      });
      const messages: string[] = [];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await withTurnContext(thread.id, { input: textInput("hello") }).catch(
          (error: { body: { message: string } }) =>
            messages.push(error.body.message),
        );
      }
      expect(messages[0]).toContain("Try again");
      expect(messages[2]).toContain("not been delivered 3 times");
      expect(messages[2]).toContain("--force");
    });
  });
});
