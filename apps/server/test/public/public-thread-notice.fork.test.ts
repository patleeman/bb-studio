import { describe, expect, it } from "vitest";
import { listEvents } from "@bb/db/testing";
import { turnRequestEventDataSchema } from "@bb/domain";
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

function seedIdleThread(harness: TestAppHarness) {
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

  it("is the system's even when another thread sent it (a runner report)", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedIdleThread(harness);
      const runner = seedThread(harness.deps, {
        environmentId: thread.environmentId,
        projectId: thread.projectId,
        providerId: "claude-code",
        status: "idle",
      });
      const response = await send(harness, thread.id, {
        mode: "auto",
        senderThreadId: runner.id,
        input: ALERT,
        experimental_notice: { source: "runner", label: "House" },
      });
      expect(response.status).toBe(200);
      expect(lastRequest(harness, thread.id)).toMatchObject({
        initiator: "system",
        systemMessageSubject: { kind: "automation", label: "House" },
      });
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
});
