import {
  getLatestThreadSequence,
  getThread,
  listStoredEventRows,
} from "@bb/db";
import { threadResponseSchema } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  listQueuedThreadCommands,
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedEvent,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";
import { turnScope } from "@bb/domain";

const PATH = "/tmp/fork-start-fallback";
const SESSION = "22ac1ae2-e9ed-418f-ae36-2e9729236382";

function seedParent(harness: TestAppHarness) {
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
  const parent = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
  });
  seedThreadRuntimeState(harness.deps, {
    environmentId: environment.id,
    inputText: "When do we ship?",
    providerThreadId: SESSION,
    threadId: parent.id,
  });
  seedTurnStarted(harness.deps, {
    environmentId: environment.id,
    providerThreadId: SESSION,
    threadId: parent.id,
    turnId: "turn-ship",
  });
  const item = (id: string, value: Record<string, unknown>) =>
    seedEvent(harness.deps, {
      threadId: parent.id,
      environmentId: environment.id,
      providerThreadId: SESSION,
      sequence:
        getLatestThreadSequence(harness.db, { threadId: parent.id }) + 1,
      type: "item/completed",
      scope: turnScope("turn-ship"),
      data: { item: { id, ...value } },
    } as never);
  item("user-1", {
    type: "userMessage",
    content: [{ type: "text", text: "When do we ship?" }],
  });
  item("agent-1", {
    type: "agentMessage",
    text: "Friday, after QA signs off.",
  });
  seedEvent(harness.deps, {
    threadId: parent.id,
    environmentId: environment.id,
    providerThreadId: SESSION,
    sequence: getLatestThreadSequence(harness.db, { threadId: parent.id }) + 1,
    type: "turn/completed",
    scope: turnScope("turn-ship"),
    data: { status: "completed" },
  } as never);
  return { parent };
}

async function fork(harness: TestAppHarness, sourceThreadId: string) {
  const response = await harness.app.request("/api/v1/threads/fork", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceThreadId, visibility: "visible" }),
  });
  expect(response.status).toBe(201);
  return threadResponseSchema.parse(await readJson(response));
}

function texts(input: readonly { type: string; text?: string }[]) {
  return input.flatMap((part) =>
    part.type === "text" && part.text !== undefined ? [part.text] : [],
  );
}

describe("a fork whose parent session can't be copied", () => {
  it("starts from the transcript instead, without an error row, and seeds the first message with it", async () => {
    await withTestHarness(async (harness) => {
      const { parent } = seedParent(harness);
      const created = await fork(harness, parent.id);

      const start = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === created.id,
      );
      if (start.command.type !== "thread.start")
        throw new Error("expected thread.start");
      expect(start.command.fork?.sourceProviderThreadId).toBe(SESSION);
      await reportQueuedCommandError(harness, start, {
        errorCode: "provider_error",
        errorMessage: `Session ${SESSION} not found`,
      });

      expect(getThread(harness.db, created.id)?.status).toBe("idle");
      const rows = listStoredEventRows(harness.db, { threadId: created.id });
      expect(rows.some((row) => row.type === "system/error")).toBe(false);
      expect(rows.map((row) => row.data).join("\n")).not.toContain("not found");

      const sent = await harness.app.request(
        `/api/v1/threads/${created.id}/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            input: textInput("Why Friday?"),
            mode: "auto",
          }),
        },
      );
      expect(sent.status).toBeLessThan(300);
      const next = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" &&
          command.threadId === created.id &&
          command !== start.command,
      );
      if (next.command.type !== "thread.start")
        throw new Error("expected thread.start");
      expect(next.command.fork).toBeUndefined();
      const sentTexts = texts(next.command.input);
      expect(sentTexts.at(-1)).toBe("Why Friday?");
      expect(sentTexts[0]).toContain("User: When do we ship?");
      expect(sentTexts[0]).toContain("Assistant: Friday, after QA signs off.");
      expect(next.command.input[0]).toMatchObject({ visibility: "agent-only" });
      await reportQueuedCommandSuccess(harness, next, {
        providerThreadId: "provider-from-transcript",
      });
      expect(getThread(harness.db, created.id)?.status).not.toBe("error");
    });
  });

  it("restarts a fork that carried input without its session, the transcript first", async () => {
    await withTestHarness(async (harness) => {
      const { parent } = seedParent(harness);
      const response = await harness.app.request("/api/v1/threads/fork", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceThreadId: parent.id,
          visibility: "visible",
          input: textInput("Carry on"),
        }),
      });
      expect(response.status).toBe(201);
      const created = threadResponseSchema.parse(await readJson(response));
      const start = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === created.id,
      );
      await reportQueuedCommandError(harness, start, {
        errorCode: "provider_error",
        errorMessage: `Session ${SESSION} not found`,
      });
      const retry = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" &&
          command.threadId === created.id &&
          command !== start.command,
      );
      if (retry.command.type !== "thread.start")
        throw new Error("expected thread.start");
      expect(retry.command.fork).toBeUndefined();
      expect(texts(retry.command.input).at(-1)).toBe("Carry on");
      expect(texts(retry.command.input)[0]).toContain(
        "Assistant: Friday, after QA signs off.",
      );
      expect(
        listQueuedThreadCommands(harness, "thread.start", created.id).length,
      ).toBeGreaterThanOrEqual(1);
      expect(getThread(harness.db, created.id)?.status).not.toBe("error");
    });
  });
});
