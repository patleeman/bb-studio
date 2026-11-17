import { afterEach, describe, expect, it } from "vitest";
import { listEvents } from "@bb/db/testing";
import {
  createStandaloneBuiltinCompactCommandInput,
  encodeClientTurnRequestIdNumber,
  turnRequestEventDataSchema,
  turnScope,
  type TurnRequestEventData,
} from "@bb/domain";
import {
  registerTurnContextProvider,
  withTurnContext,
} from "../../src/services/threads/turn-context.fork.js";
import { retrySystemCompactionNotice } from "../../src/services/threads/system-compaction.fork.js";
import {
  registerHostRpcResponder,
  type HostRpcHandlerResult,
  EMPTY_WORKSPACE_AGENT_CONTEXT,
} from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import {
  seedEvent,
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

const disposers: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

describe("a compaction with a reason (BB Studio)", () => {
  it.each([
    ["with a reason", "?reason=cache%20warming%20ended"],
    ["typed", ""],
  ])(
    "sends the provider a bare /compact %s, even when a plugin adds turn context",
    async (_label, query) => {
      await withTestHarness(async (harness) => {
        let asked = 0;
        disposers.push(
          registerTurnContextProvider("studio", () => {
            asked += 1;
            return "Elsewhere: two workers running.";
          }),
        );
        const { thread, responder } = seedCompactable(harness, "codex");
        const response = await harness.app.request(
          `/api/v1/threads/${thread.id}/compact${query}`,
          { method: "POST" },
        );
        expect(response.status).toBe(200);
        const submits = responder.requests.filter(
          ({ command }) => command.type === "turn.submit",
        );
        expect(submits).toHaveLength(1);
        expect(submits[0]?.command).toMatchObject({
          input: createStandaloneBuiltinCompactCommandInput(),
        });
        expect(
          (submits[0]?.command as { input: unknown[] }).input,
        ).toHaveLength(1);
        expect(asked).toBe(0);
      });
    },
  );

  it("adds no turn context to a /clear either, but still to a message", async () => {
    disposers.push(registerTurnContextProvider("studio", () => "digest"));
    const clear = [
      {
        type: "text" as const,
        text: "/clear",
        mentions: [
          {
            start: 0,
            end: 6,
            resource: {
              kind: "command" as const,
              trigger: "/" as const,
              name: "clear",
              source: "command" as const,
              origin: "builtin" as const,
              label: "clear",
              argumentHint: null,
            },
          },
        ],
      },
    ];
    expect((await withTurnContext("thr_1", { input: clear })).input).toEqual(
      clear,
    );
    const message = [{ type: "text" as const, text: "hi", mentions: [] }];
    expect(
      (await withTurnContext("thr_1", { input: message })).input,
    ).toHaveLength(2);
  });

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

  it.each([
    ["empty", " "],
    ["two lines", "cache warming\nended"],
    ["a tab", "cache\twarming"],
    ["a bidi override", "cache \u202ewarming"],
    ["a zero-width space", "cache\u200bwarming"],
    ["a line separator", "cache\u2028warming"],
    ["over 200 characters", "x".repeat(201)],
  ])("refuses a reason with %s", async (_label, reason) => {
    await withTestHarness(async (harness) => {
      const { thread, responder } = seedCompactable(harness, "claude-code");
      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/compact?reason=${encodeURIComponent(reason)}`,
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

  it("takes a reason of exactly 200 characters", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedCompactable(harness, "claude-code");
      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/compact?reason=${"x".repeat(200)}`,
        { method: "POST" },
      );
      expect(response.status).toBe(200);
    });
  });
});

describe("retrying a compaction bb ran on its own", () => {
  function failedRequest(initiator: "system" | "user"): TurnRequestEventData {
    return {
      direction: "outbound",
      requestId: encodeClientTurnRequestIdNumber({ value: 7 }),
      source: "tell",
      initiator,
      senderThreadId: null,
      ...(initiator === "system"
        ? {
            systemMessageKind: "unlabeled" as const,
            systemMessageSubject: {
              kind: "compaction" as const,
              reason: "cache warming ended",
            },
          }
        : {}),
      input: createStandaloneBuiltinCompactCommandInput(),
      target: { kind: "new-turn" },
      request: { method: "turn/start", params: {} },
      execution: {
        model: "claude-opus-5-5",
        serviceTier: "default",
        reasoningLevel: "medium",
        permissionMode: "full",
        source: "client/turn/requested",
      },
    } as TurnRequestEventData;
  }

  it("keeps its reason when it sends the same /compact again", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedCompactable(harness, "claude-code");
      expect(
        retrySystemCompactionNotice(harness.db, {
          threadId: thread.id,
          failed: { request: failedRequest("system"), requestSequence: 1 },
        }),
      ).toEqual({
        kind: "unlabeled",
        subject: { kind: "compaction", reason: "cache warming ended" },
      });
      expect(
        retrySystemCompactionNotice(harness.db, {
          threadId: thread.id,
          failed: { request: failedRequest("user"), requestSequence: 1 },
        }),
      ).toBeNull();
    });
  });

  it("carries no reason when the retry continues an accepted turn instead", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedCompactable(harness, "claude-code");
      const request = failedRequest("system");
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: thread.environmentId,
        providerThreadId: "provider-thread-1",
        sequence: 5,
        type: "turn/input/accepted",
        scope: turnScope("turn-1"),
        data: {
          providerThreadId: "provider-thread-1",
          clientRequestId: request.requestId,
        },
      });
      expect(
        retrySystemCompactionNotice(harness.db, {
          threadId: thread.id,
          failed: { request, requestSequence: 1 },
        }),
      ).toBeNull();
    });
  });
});
