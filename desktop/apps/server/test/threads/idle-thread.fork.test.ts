import { getThread, listQueuedThreadMessages } from "@bb/db";
import { threadSchema } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { createsIdleThread } from "../../src/services/threads/idle-thread.fork.js";
import { resolvePendingThreadSessionOptions } from "../../src/services/threads/thread-session-options.js";
import { registerTestHostRpcCapture } from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import { installFakeGitWorktreeProvider } from "../helpers/environment-provider.js";
import {
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

async function create(
  harness: TestAppHarness,
  projectId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return harness.app.request("/api/v1/threads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      projectId,
      providerId: "codex",
      environment: { type: "project-default" },
      ...body,
    }),
  });
}

function seed(harness: TestAppHarness, id: string) {
  installFakeGitWorktreeProvider();
  const { host, session } = seedHostSession(harness.deps, { id });
  seedPrimaryHost(harness.deps, host.id);
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: `/tmp/${id}`,
  });
  registerTestHostRpcCapture(harness, {
    hostId: host.id,
    sessionId: session.id,
  });
  return project;
}

describe("an idle thread a plugin creates", () => {
  it("is created pending with no input, nothing queued and no turn", async () => {
    await withTestHarness(async (harness) => {
      const project = seed(harness, "host-idle-thread");
      const response = await create(harness, project.id, {
        origin: "plugin",
        originPluginId: "studio",
        pluginMetadata: { bot: "bot_main" },
        title: "Assistant",
        input: [],
      });
      expect(response.status).toBe(201);
      const thread = threadSchema.parse(await readJson(response));
      expect(getThread(harness.db, thread.id)).toMatchObject({
        status: "pending",
        title: "Assistant",
        originPluginId: "studio",
        environmentId: null,
      });
      expect(listQueuedThreadMessages(harness.db, thread.id)).toEqual([]);
    });
  });

  it("keeps the session options it was created with for its first message", async () => {
    await withTestHarness(async (harness) => {
      const project = seed(harness, "host-idle-thread-options");
      const response = await create(harness, project.id, {
        origin: "plugin",
        originPluginId: "studio",
        input: [],
        sessionOptions: { mode: "plan" },
      });
      expect(response.status).toBe(201);
      const thread = threadSchema.parse(await readJson(response));
      expect(resolvePendingThreadSessionOptions(harness.db, thread.id)).toEqual(
        { mode: "plan" },
      );
    });
  });

  it("still needs input from anyone but a plugin", async () => {
    await withTestHarness(async (harness) => {
      const project = seed(harness, "host-idle-thread-sdk");
      const response = await create(harness, project.id, {
        origin: "sdk",
        input: [],
      });
      expect(response.status).toBe(400);
    });
  });

  it("is only a plugin's root thread with empty input", () => {
    expect(
      createsIdleThread({ origin: "plugin", originKind: null, input: [] }),
    ).toBe(true);
    expect(
      createsIdleThread({ origin: "plugin", originKind: "fork", input: [] }),
    ).toBe(false);
    expect(createsIdleThread({ origin: "sdk", input: [] })).toBe(false);
    expect(
      createsIdleThread({
        origin: "plugin",
        input: [{ type: "text", text: "hi", mentions: [] }],
      }),
    ).toBe(false);
  });
});
