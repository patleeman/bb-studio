import { describe, expect, it } from "vitest";
import { listEvents } from "@bb/db/testing";
import { getLatestThreadSequence, listQueuedThreadMessages } from "@bb/db";
import { applyTurnCompletedEvent } from "../../src/internal/turn-completed-events.js";
import { sendNextQueuedMessageIfPresent } from "../../src/services/threads/queued-messages.js";
import { turnRequestEventDataSchema, turnScope } from "@bb/domain";
import {
  registerHostRpcResponder,
  type HostRpcHandlerResult,
  EMPTY_WORKSPACE_AGENT_CONTEXT,
} from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import { automationNotice } from "../../src/services/threads/automation-notice.fork.js";
import {
  seedEvent,
  seedTurnStarted,
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function seedIdleThread(
  harness: TestAppHarness,
  status: "idle" | "active" = "idle",
) {
  const { host, session } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
  });
  const thread = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
    providerId: "claude-code",
    status,
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

const ALERT = [
  {
    type: "text" as const,
    text: "[bb studio] Watcher Kensico health: problems on red4: disk 91%",
    mentions: [],
  },
  {
    type: "text" as const,
    text: "Your watcher's script found the output above.",
    mentions: [],
    visibility: "agent-only" as const,
  },
];

async function send(harness: TestAppHarness, threadId: string, body: object) {
  return harness.app.request(`/api/v1/threads/${threadId}/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function lastRequest(harness: TestAppHarness, threadId: string) {
  return listEvents(harness.db, { threadId })
    .filter((event) => event.type === "client/turn/requested")
    .map((event) => turnRequestEventDataSchema.parse(JSON.parse(event.data)))
    .at(-1);
}

describe("an automated input sent with a notice (BB Studio)", () => {
  it("is the system's turn with the notice as its subject, and reaches the model unchanged, still able to ask", async () => {
    await withTestHarness(async (harness) => {
      const { thread, responder } = seedIdleThread(harness);
      const response = await send(harness, thread.id, {
        mode: "auto",
        permissionMode: "accept-edits",
        input: ALERT,
        experimental_notice: { source: "watcher", label: "Kensico health" },
      });
      expect(
        response.status,
        JSON.stringify(await readJson(response.clone())),
      ).toBe(200);
      expect(lastRequest(harness, thread.id)).toMatchObject({
        initiator: "system",
        senderThreadId: null,
        systemMessageKind: "unlabeled",
        systemMessageSubject: {
          kind: "automation",
          source: "watcher",
          label: "Kensico health",
        },
        input: ALERT,
      });
      const submits = responder.requests.filter(
        ({ command }) => command.type === "turn.submit",
      );
      expect(submits).toHaveLength(1);
      expect(submits[0]?.command).toMatchObject({ input: ALERT });
      expect(JSON.stringify(submits[0]?.command)).toContain(
        '"permissionEscalation":"ask"',
      );
    });
  });

  it("stays another thread's turn when that thread sent it (a runner report): its sender kept, approvals denied", async () => {
    await withTestHarness(async (harness) => {
      const { thread, responder } = seedIdleThread(harness);
      const runner = seedThread(harness.deps, {
        environmentId: thread.environmentId,
        projectId: thread.projectId,
        providerId: "claude-code",
        status: "idle",
      });
      const response = await send(harness, thread.id, {
        mode: "auto",
        permissionMode: "accept-edits",
        senderThreadId: runner.id,
        input: ALERT,
        experimental_notice: { source: "runner", label: "House" },
      });
      expect(response.status).toBe(200);
      expect(lastRequest(harness, thread.id)).toMatchObject({
        initiator: "agent",
        senderThreadId: runner.id,
        systemMessageSubject: {
          kind: "automation",
          source: "runner",
          label: "House",
        },
      });
      expect(JSON.stringify(responder.requests.at(-1)?.command)).toContain(
        '"permissionEscalation":"deny"',
      );
    });
  });

  it("drops the notice for a thread that is pending or has no environment", () => {
    const notice = { source: "watcher" as const, label: "Kensico health" };
    expect(
      automationNotice(notice, { status: "pending", environmentId: "env_1" }),
    ).toBeNull();
    expect(
      automationNotice(notice, { status: "idle", environmentId: null }),
    ).toBeNull();
    expect(
      automationNotice(notice, { status: "idle", environmentId: "env_1" }),
    ).toEqual({
      kind: "unlabeled",
      subject: {
        kind: "automation",
        source: "watcher",
        label: "Kensico health",
      },
    });
  });

  it("leaves a send without a notice as the user's, as typed", async () => {
    await withTestHarness(async (harness) => {
      const { thread, responder } = seedIdleThread(harness);
      const response = await send(harness, thread.id, {
        mode: "auto",
        permissionMode: "accept-edits",
        input: [{ type: "text", text: "Status?", mentions: [] }],
      });
      expect(response.status).toBe(200);
      const request = lastRequest(harness, thread.id);
      expect(request?.initiator).toBe("user");
      expect(request?.systemMessageSubject ?? null).toBeNull();
      expect(JSON.stringify(responder.requests.at(-1)?.command)).toContain(
        '"permissionEscalation":"ask"',
      );
    });
  });

  it.each([
    ["an empty label", { source: "watcher", label: " " }],
    ["a two-line label", { source: "watcher", label: "a\nb" }],
    ["a bidi label", { source: "watcher", label: "a \u202eb" }],
    ["a long label", { source: "watcher", label: "x".repeat(121) }],
    ["no source", { label: "Kensico" }],
  ])("refuses %s", async (_label, notice) => {
    await withTestHarness(async (harness) => {
      const { thread, responder } = seedIdleThread(harness);
      const response = await send(harness, thread.id, {
        mode: "auto",
        input: ALERT,
        experimental_notice: notice,
      });
      expect(response.status).toBe(400);
      expect(
        responder.requests.filter(
          ({ command }) => command.type === "turn.submit",
        ),
      ).toHaveLength(0);
    });
  });

  it("delivers a notice with a source BB doesn't know as an ordinary message, so no alert is lost", async () => {
    await withTestHarness(async (harness) => {
      const { thread, responder } = seedIdleThread(harness);
      const response = await send(harness, thread.id, {
        mode: "auto",
        input: ALERT,
        experimental_notice: { source: "studio", label: "Kensico" },
      });
      expect(response.status).toBe(200);
      const request = lastRequest(harness, thread.id);
      expect(request?.initiator).toBe("user");
      expect(request?.systemMessageSubject ?? null).toBeNull();
      expect(
        responder.requests.filter(
          ({ command }) => command.type === "turn.submit",
        ),
      ).toHaveLength(1);
    });
  });
});

describe("a queued automated input (BB Studio)", () => {
  async function queueThenDrain(
    harness: TestAppHarness,
    body: (runnerId: string) => object,
  ) {
    const { thread, responder } = seedIdleThread(harness, "active");
    const runner = seedThread(harness.deps, {
      environmentId: thread.environmentId,
      projectId: thread.projectId,
      providerId: "claude-code",
      status: "idle",
    });
    const turnId = "turn-busy";
    seedTurnStarted(harness.deps, {
      environmentId: thread.environmentId,
      providerThreadId: "provider-thread-1",
      threadId: thread.id,
      turnId,
    });
    const response = await send(harness, thread.id, body(runner.id));
    expect(response.status, JSON.stringify(await readJson(response.clone()))).toBe(200);
    expect(listQueuedThreadMessages(harness.db, thread.id)).toHaveLength(1);
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: thread.environmentId,
      providerThreadId: "provider-thread-1",
      sequence: getLatestThreadSequence(harness.db, { threadId: thread.id }) + 1,
      type: "turn/completed",
      scope: turnScope(turnId),
      data: { providerThreadId: "provider-thread-1", status: "completed" },
    });
    applyTurnCompletedEvent(harness.deps, {
      afterIdle: null,
      payload: {
        threadId: thread.id,
        providerThreadId: "provider-thread-1",
        type: "turn/completed",
        scope: turnScope(turnId),
        status: "completed",
      },
    });
    expect(
      await sendNextQueuedMessageIfPresent(harness.deps, { threadId: thread.id }),
    ).toBe(true);
    await expect
      .poll(
        () =>
          responder.requests.filter(({ command }) => command.type === "turn.submit")
            .length,
      )
      .toBe(1);
    const submit = responder.requests.find(
      ({ command }) => command.type === "turn.submit",
    )!.command;
    return { thread, runnerId: runner.id, submit };
  }

  it("stays the runner's turn: sender and header kept, approvals denied", async () => {
    await withTestHarness(async (harness) => {
      const { thread, runnerId, submit } = await queueThenDrain(harness, (runnerId) => ({
        mode: "queue-if-active",
        permissionMode: "accept-edits",
        senderThreadId: runnerId,
        input: ALERT,
        experimental_notice: { source: "runner", label: "House" },
      }));
      expect(lastRequest(harness, thread.id)).toMatchObject({
        initiator: "agent",
        senderThreadId: runnerId,
        systemMessageSubject: { kind: "automation", source: "runner", label: "House" },
      });
      const text = JSON.stringify(submit);
      expect(text).toContain(`[bb message from thread:${runnerId}`);
      expect(text).toContain('"permissionEscalation":"deny"');
    });
  });

  it("keeps a Studio check-in's stored model and settings, and its notice", async () => {
    await withTestHarness(async (harness) => {
      const { thread, submit } = await queueThenDrain(harness, () => ({
        mode: "queue-if-active",
        model: "gpt-5-mini",
        reasoningLevel: "high",
        permissionMode: "accept-edits",
        input: ALERT,
        experimental_notice: { source: "check-in", label: "Morning card" },
      }));
      expect(lastRequest(harness, thread.id)).toMatchObject({
        initiator: "system",
        systemMessageSubject: { kind: "automation", source: "check-in", label: "Morning card" },
        execution: { model: "gpt-5-mini", reasoningLevel: "high", permissionMode: "accept-edits" },
      });
      expect(submit).toMatchObject({
        options: { model: "gpt-5-mini", reasoningLevel: "high", permissionMode: "accept-edits", permissionEscalation: "ask" },
      });
    });
  });
});

