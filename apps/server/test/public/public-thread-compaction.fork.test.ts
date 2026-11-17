import { describe, expect, it } from "vitest";
import { listEvents } from "@bb/db/testing";
import {
  createStandaloneBuiltinCompactCommandInput,
  turnRequestEventDataSchema,
} from "@bb/domain";
import {
  registerHostRpcResponder,
  type HostRpcHandlerResult,
  EMPTY_WORKSPACE_AGENT_CONTEXT,
} from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function seedCompactable(harness: TestAppHarness, providerId: string) {
  const { host, session } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
  });
  const thread = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
    providerId,
    status: "idle",
  });
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    providerThreadId: "provider-thread-1",
    threadId: thread.id,
  });
  const responder = registerHostRpcResponder(harness, {
    hostId: host.id,
    sessionId: session.id,
    handle: ({ command }): HostRpcHandlerResult => {
      if (command.type === "host.read_workspace_agent_context") {
        return { ok: true, result: EMPTY_WORKSPACE_AGENT_CONTEXT };
      }
      if (command.type === "turn.submit") {
        return { ok: true, result: { trace: { spans: [] } } };
      }
      return { ok: true, result: {} };
    },
  });
  return { thread, responder };
}

function turnRequests(harness: TestAppHarness, threadId: string) {
  return listEvents(harness.db, { threadId })
    .filter((event) => event.type === "client/turn/requested")
    .map((event) => turnRequestEventDataSchema.parse(JSON.parse(event.data)));
}

describe("a compaction with a reason (BB Studio)", () => {
  it.each(["claude-code", "codex", "pi"])(
    "is the system's on %s, records why, and sends the provider the same /compact",
    async (providerId) => {
      await withTestHarness(async (harness) => {
        const { thread, responder } = seedCompactable(harness, providerId);
        const response = await harness.app.request(
          `/api/v1/threads/${thread.id}/compact?reason=${encodeURIComponent("cache warming ended")}`,
          { method: "POST" },
        );
        expect(
          response.status,
          JSON.stringify(await readJson(response.clone())),
        ).toBe(200);
        const submits = responder.requests.filter(
          ({ command }) => command.type === "turn.submit",
        );
        expect(submits).toHaveLength(1);
        expect(submits[0]?.command).toMatchObject({
          input: createStandaloneBuiltinCompactCommandInput(),
        });
        expect(turnRequests(harness, thread.id).slice(-1)).toEqual([
          expect.objectContaining({
            initiator: "system",
            senderThreadId: null,
            input: createStandaloneBuiltinCompactCommandInput(),
            systemMessageKind: "unlabeled",
            systemMessageSubject: {
              kind: "compaction",
              reason: "cache warming ended",
            },
          }),
        ]);
      });
    },
  );

  it("stays the user's without a reason, as a typed /compact or Compact now", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedCompactable(harness, "claude-code");
      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/compact`,
        { method: "POST" },
      );
      expect(response.status).toBe(200);
      const request = turnRequests(harness, thread.id).at(-1);
      expect(request?.initiator).toBe("user");
      expect(request?.systemMessageSubject ?? null).toBeNull();
    });
  });

  it("refuses an empty reason", async () => {
    await withTestHarness(async (harness) => {
      const { thread, responder } = seedCompactable(harness, "claude-code");
      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/compact?reason=%20`,
        { method: "POST" },
      );
      expect(response.status).toBe(400);
      expect(
        responder.requests.filter(
          ({ command }) => command.type === "turn.submit",
        ),
      ).toHaveLength(0);
    });
  });
});
