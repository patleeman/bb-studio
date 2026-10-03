import { createTestStore } from "./test-store";
import { test } from "vitest";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createFakePluginHost, makeThreadResponse, makePluginAgentConfigurationContext } from "@get-bb/plugin-sdk/testing";
import type { PluginCliContext } from "@get-bb/plugin-sdk";
import { botSchema, type BotCreateRequest } from "../contract";
import { Store } from "../store";
import plugin from "../server";

async function setup() {
  const files = new Map<string, Buffer>();
  const host = createFakePluginHost({
    pluginId: "bot-teams",
    agentSkillIds: ["bots"],
    sdk: {
      plugins: { callRpc: async (args) => args.outputSchema.parse([]) },
      system: {
        config: async () => ({
          primaryHostId: "host_primary",
          voiceTranscriptionEnabled: true,
        }),
        transcribeVoice: async () => ({ text: "Transcribed words" }),
      },
      projects: {
        list: async () => [{ id: "proj_personal", kind: "personal", name: "Personal", sources: [], gitRemoteUrl: null, createdAt: 1, updatedAt: 1 }],
        create: async () => ({ id: "proj_bots" }),
        attachments: {
          upload: async ({ filename }) => ({
            path: `stored/${filename}`,
            name: filename,
            type: "localFile",
            sizeBytes: 5,
            mimeType: "text/plain",
          }),
          read: async () => ({
            bytes: Buffer.from("hello"),
            mimeType: "text/plain",
          }),
        },
      },
      threads: {
        get: async () => makeThreadResponse({ environmentId: "env_remote" }),
        list: async () => [],
        update: async () => makeThreadResponse(),
        stop: async () => ({ ok: true }),
        queuedMessages: {
          list: async () => [],
          delete: async () => ({ ok: true }),
        },
      },
      environments: { get: async () => ({ hostId: "host_remote" }) },
      files: {
        read: async ({ hostId, path }) => {
          const bytes = files.get(`${hostId}:${path}`);
          if (!bytes) throw new Error("File not found");
          return {
            path,
            content: bytes.toString("base64"),
            contentEncoding: "base64",
            sizeBytes: bytes.length,
            sha256: "version",
            mimeType: "text/plain",
          };
        },
        write: async ({
          hostId,
          path,
          content,
          contentEncoding,
          expectedSha256,
        }) => {
          const key = `${hostId}:${path}`;
          if (expectedSha256 === null && files.has(key))
            return { outcome: "conflict", currentSha256: "existing" };
          const bytes = Buffer.from(content, contentEncoding ?? "utf8");
          files.set(key, bytes);
          return {
            outcome: "written",
            sha256: "saved",
            sizeBytes: bytes.length,
          };
        },
      },
    },
  });
  await plugin(host.bb);
  const run = (args: string[], ctx: PluginCliContext = {}) =>
    host.harness.behavior.runCli(args, ctx);
  const ok = async (args: string[], ctx: PluginCliContext = {}) => {
    const result = await run([...args, "--json"], ctx);
    assert.equal(result.exitCode, 0, result.stderr);
    return JSON.parse(result.stdout) as unknown;
  };
  const create = async (name = "Atlas") =>
    botSchema.parse(
      await ok([
        "create",
        name,
        "--mission",
        "Verify facts.",
        "--model",
        "model-a",
        "--reasoning",
        "low",
      ]),
    );
  return {
    ...host,
    files,
    run,
    ok,
    create,
    store: createTestStore(host.bb.storage.database()),
    close: () => host.harness.lifecycle.dispose(),
  };
}

test("CLI creates and patches profiles, preserves fields, and exposes its skill", async () => {
  const x = await setup();
  try {
    const b = await x.create();
    assert.equal(b.intervalMinutes, 0);
    assert.match((await x.run(["mission", "@atlas"])).stdout, /Verify facts/);
    await x.ok(["memory", "@atlas", "--text", "Remember the release window."]);
    assert.equal((await x.run(["memory", "@atlas"])).stdout, "Remember the release window.");
    const stale = await x.run(["memory", "@atlas", "--text", "Changed", "--version", "stale"]);
    assert.equal(stale.exitCode, 1);
    assert.match(stale.stderr ?? "", /changed/);
    const updated = botSchema.parse(
      await x.ok([
        "update",
        "@atlas",
        "--description",
        "Researcher",
        "--interval",
        "15",
      ]),
    );
    assert.equal(updated.model, "model-a");
    assert.equal(updated.reasoningLevel, "low");
    assert.equal(updated.intervalMinutes, 15);
    assert.equal(
      botSchema.parse(await x.ok(["show", b.id])).description,
      "Researcher",
    );
    const changed = await x.run(["update", b.id, "--provider", "different"]);
    assert.equal(changed.exitCode, 0);
    assert.equal(x.store.get(b.id).providerId, "different");
    await x.ok(["update", b.id, "--fallback-provider", "codex",
      "--fallback-model", "backup", "--fallback-reasoning", "high"]);
    const swapped = botSchema.parse(await x.ok(["swap", b.id]));
    assert.equal(swapped.providerId, "codex");
    assert.equal(swapped.model, "backup");
    assert.equal(swapped.fallbackProviderId, "different");
    const invalid = await x.run(["update", b.id, "--interval", "-1"]);
    assert.equal(invalid.exitCode, 1);
    await x.create("Atlas");
    const ambiguous = await x.run(["show", "ATLAS"]);
    assert.equal(ambiguous.exitCode, 1);
    assert.match(ambiguous.stderr, /ambiguous/);
    assert.equal(botSchema.parse(await x.ok(["show", "@atlas"])).id, b.id);
    const config = await x.harness.behavior.resolveAgentConfiguration(
      makePluginAgentConfigurationContext(),
    );
    assert.deepEqual(config.skills, ["bots"]);
  } finally {
    await x.close();
  }
});

test("bot CLI creation waits for explicit owner approval", async () => {
  const x = await setup();
  try {
    const requester = await x.create("Requester");
    x.store.putConversation({
      id: "requester-admin",
      botId: requester.id,
      key: "admin",
      kind: "admin",
      threadId: "thr_requester",
      title: "Requester",
      createdAt: Date.now(),
    });
    const ctx = { threadId: "thr_requester" };
    const before = x.store.all().length;
    const pendingRun = x.run(
      ["create", "Approved", "--mission", "Coordinate the team."],
      ctx,
    );
    for (let attempt = 0; attempt < 20; attempt++) {
      if (x.store.botCreateRequests().length) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const pending = x.store.botCreateRequests()[0];
    assert.ok(pending);
    assert.equal(x.store.all().length, before);
    assert.deepEqual(pending.input, {
      name: "Approved",
      avatar: "🤖",
      description: "",
      providerId: "codex",
      model: "",
      fallbackProviderId: "",
      fallbackModel: "",
      fallbackReasoningLevel: "medium",
      reasoningLevel: "medium",
      permissionMode: "accept-edits",
      intervalMinutes: 0,
      mission: "Coordinate the team.",
    });
    const listed = (await x.harness.behavior.callRpc("list", null)) as {
      botCreateRequests: Array<{
        id: string;
        name: string;
        requesterName: string;
        mission: string;
        missionTruncated: boolean;
      }>;
    };
    assert.equal(listed.botCreateRequests.length, 1);
    assert.deepEqual(listed.botCreateRequests[0], {
      ...listed.botCreateRequests[0],
      id: pending.id,
      name: "Approved",
      requesterName: "Requester",
      mission: "Coordinate the team.",
      missionTruncated: false,
    });
    await x.harness.behavior.callRpc("resolveBotCreateRequest", {
      id: pending.id,
      approved: true,
    });
    const created = botSchema.parse(await pendingRun.then((result) => {
      assert.equal(result.exitCode, 0, result.stderr);
      return JSON.parse(result.stdout);
    }));
    assert.equal(created.name, "Approved");
    assert.equal(x.store.all().length, before + 1);

    const deniedRun = x.run(
      ["create", "Denied", "--mission", "No workspace should be created."],
      ctx,
    );
    for (let attempt = 0; attempt < 20; attempt++) {
      if (x.store.botCreateRequests().some((request) => request.input.name === "Denied"))
        break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const denied = x.store
      .botCreateRequests()
      .find((request) => request.input.name === "Denied");
    assert.ok(denied);
    await x.harness.behavior.callRpc("resolveBotCreateRequest", {
      id: denied.id,
      approved: false,
    });
    const deniedResult = await deniedRun;
    assert.equal(deniedResult.exitCode, 1);
    assert.match(deniedResult.stderr, /not approved/);
    assert.equal(x.store.all().some((b) => b.name === "Denied"), false);
  } finally {
    await x.close();
  }
});

test("approved bot creation is recovered when the requester has already exited", async () => {
  const x = await setup();
  try {
    const requester = await x.create("Requester");
    const now = Date.now();
    const request: BotCreateRequest = {
      id: randomUUID(),
      requesterBotId: requester.id,
      requesterThreadId: "thr_finished_requester",
      requesterName: requester.name,
      channelName: null,
      input: {
        name: "Recovered",
        avatar: "🤖",
        description: "Recovered after approval.",
        providerId: "codex",
        model: "",
        fallbackProviderId: "",
        fallbackModel: "",
        fallbackReasoningLevel: "medium",
        reasoningLevel: "medium",
        permissionMode: "auto",
        intervalMinutes: 0,
        mission: "Continue after the requester exits.",
      },
      status: "pending",
      createdAt: now,
      expiresAt: now + 300_000,
      resolvedAt: null,
      createdBotId: null,
    };
    x.store.putBotCreateRequest(request);

    await x.harness.behavior.callRpc("resolveBotCreateRequest", {
      id: request.id,
      approved: true,
    });

    const resolved = x.store.botCreateRequest(request.id);
    assert.equal(resolved?.status, "created");
    assert.ok(resolved?.createdBotId);
    assert.equal(x.store.get(resolved!.createdBotId!).name, "Recovered");
  } finally {
    await x.close();
  }
});

test("approved creation rolls back the bot when recording completion fails", async () => {
  const x = await setup();
  const markCreated = Store.prototype.markBotCreateRequestCreated;
  try {
    const requester = await x.create("Requester");
    const request: BotCreateRequest = {
      id: randomUUID(),
      requesterBotId: requester.id,
      requesterThreadId: "thr_finished_requester",
      requesterName: requester.name,
      channelName: null,
      input: { ...requester, name: "Atomic", mission: "Create exactly once." },
      status: "pending",
      createdAt: Date.now(),
      expiresAt: Date.now() + 300_000,
      resolvedAt: null,
      createdBotId: null,
    };
    x.store.putBotCreateRequest(request);
    Store.prototype.markBotCreateRequestCreated = function () {
      throw new Error("Simulated request write failure");
    };
    await assert.rejects(x.harness.behavior.callRpc("resolveBotCreateRequest", {
      id: request.id, approved: true,
    }), /Simulated request write failure/);
    assert.deepEqual(x.store.all().map((bot) => bot.id), [requester.id]);
    assert.equal(x.store.botCreateRequest(request.id)?.status, "approved");
    Store.prototype.markBotCreateRequestCreated = markCreated;
    x.harness.sdk.stub("threads.list", async () => []);
    const service = x.harness.behavior.runService("bots");
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (x.store.botCreateRequest(request.id)?.status === "created") break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.equal(x.store.botCreateRequest(request.id)?.status, "created");
      assert.equal(x.store.all().filter((bot) => bot.name === "Atomic").length, 1);
    } finally {
      service.controller.abort();
      await service.done;
    }
  } finally {
    Store.prototype.markBotCreateRequestCreated = markCreated;
    await x.close();
  }
});

test("CLI updates reasoning and starts fresh threads when a model changes", async () => {
  const x = await setup();
  try {
    let sequence = 0;
    const pendingDirectStarts = new Map<string, string>();
    x.harness.sdk.stub("threads.spawn", async (args) => {
      const id = `thr_replacement_${++sequence}`;
      const input = (args as { input?: { type: string; text?: string }[] }).input;
      if (input?.length === 1 && input[0]?.type === "text" && input[0].text === "")
        pendingDirectStarts.set(id, `start_${id}`);
      return makeThreadResponse({ id, status: "idle" });
    });
    x.harness.inspection.sdk.stub("threads.queuedMessages.list", async ({ threadId }) => {
      const id = pendingDirectStarts.get(threadId);
      return id ? [{
        id,
        content: [{ type: "text", text: "" }],
        model: "default-model",
        reasoningLevel: "medium",
      }] : [];
    });
    x.harness.inspection.sdk.stub("threads.queuedMessages.delete", async ({ threadId }) => {
      pendingDirectStarts.delete(threadId);
      return { ok: true };
    });
    const bot = botSchema.parse(
      await x.ok(["create", "Default", "--mission", "Review facts"]),
    );
    x.store.putConversation({
      id: "conversation",
      botId: bot.id,
      key: "mission",
      threadId: "thr_existing",
      title: "Mission",
      kind: "mission",
      createdAt: 1,
    });
    await x.ok(["update", bot.id, "--reasoning", "high"]);
    assert.deepEqual(
      x.harness.inspection.sdk.callsTo("threads.update").at(-1)?.[0],
      { threadId: "thr_existing", reasoningLevel: "high" },
    );
    await x.ok(["update", bot.id, "--model", "model-b"]);
    assert.equal(x.store.byThread("thr_existing")?.originalKey, "mission");
    assert.equal(x.store.conversations(bot.id).some((c) => c.key === "mission"), false);
    await x.ok(["update", bot.id, "--model", ""]);
    assert.equal(x.store.get(bot.id).model, "");
  } finally {
    await x.close();
  }
});

test("CLI profile updates prune conversations whose threads were deleted", async () => {
  const x = await setup();
  try {
    const bot = await x.create("Prune");
    x.store.putConversation({
      id: "deleted-conversation",
      botId: bot.id,
      key: "mission",
      threadId: "thr_deleted",
      title: "Deleted",
      kind: "mission",
      createdAt: 1,
    });
    x.harness.inspection.sdk.stub("threads.update", async ({ threadId }) => {
      if (threadId === "thr_deleted") throw new Error("Thread not found");
      return makeThreadResponse();
    });
    const updated = botSchema.parse(
      await x.ok(["update", bot.id, "--reasoning", "high"]),
    );
    assert.equal(updated.reasoningLevel, "high");
    assert.equal(x.store.byThread("thr_deleted"), null);
  } finally {
    await x.close();
  }
});
