import { getThread, updateThread } from "@bb/db";
import { promptInputSchema } from "@bb/domain";
import { describe, expect, it, vi } from "vitest";
import { createAiServiceRegistry } from "../../src/services/ai/ai-service-registry.js";
import { runTextAiTask } from "../../src/services/ai/ai-tasks.js";
import { generateThreadMetadataWithOutcome } from "../../src/services/threads/title-generation.js";
import { noteTitleOutcome } from "../../src/services/threads/title-retry.fork.js";
import {
  hasTitleRetry,
  MAX_TITLE_RETRIES,
  runQueuedTitleRetry,
  scheduleQueuedTitleRetry,
} from "../../src/services/threads/title-retry-queue.fork.js";
import { registerFakeAiService } from "../helpers/ai-services.js";
import { waitForQueuedCommand } from "../helpers/commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const INPUT = [
  promptInputSchema.parse({
    type: "text",
    text: "Help me plan a three day trip to Lisbon in March please.",
  }),
];

function seedUntitledThread(
  harness: TestAppHarness,
  providerId: string,
  withEnvironment = false,
) {
  const { host } = seedHostSession(harness.deps, { id: "host-title" });
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = withEnvironment
    ? seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/title-retry-workspace",
        status: "ready",
      })
    : null;
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    providerId,
    environmentId: environment?.id ?? null,
    titleFallback: "Help me plan a three day trip to Lisbon in March please.",
  });
  updateThread(harness.deps.db, harness.deps.hub, thread.id, { title: null });
  return thread;
}

function registerCodexSignedOut(harness: TestAppHarness) {
  return registerFakeAiService(harness.deps.aiServices, {
    id: "codex",
    displayName: "Codex",
    pluginId: "provider-codex",
    builtin: true,
    complete: async () => "Codex title",
    status: async () => ({
      ready: false,
      message: "Run `codex login` on the primary machine to sign in",
    }),
  });
}

function registerClaudeCode(
  harness: TestAppHarness,
  args: { ready: () => boolean; title?: string },
) {
  return registerFakeAiService(harness.deps.aiServices, {
    id: "claude-code",
    displayName: "Claude Code",
    pluginId: "provider-claude-code",
    builtin: true,
    complete: async () => args.title ?? "Lisbon Trip in March",
    transcribe: null,
    status: async () =>
      args.ready()
        ? { ready: true }
        : { ready: false, message: "Run `claude` to sign in" },
  });
}

describe("conversation titles pick a signed-in provider", () => {
  it("titles a Claude Code conversation with Claude Code while Codex is signed out", async () => {
    await withTestHarness({}, async (harness) => {
      const codex = registerCodexSignedOut(harness);
      const claude = registerClaudeCode(harness, { ready: () => true });
      const thread = seedUntitledThread(harness, "claude-code");

      const outcome = await generateThreadMetadataWithOutcome(harness.deps, {
        input: INPUT,
        threadId: thread.id,
      });

      expect(outcome.metadata).toEqual({ title: "Lisbon Trip in March" });
      expect(codex.completeCalls).toEqual([]);
      expect(claude.completeCalls).toHaveLength(1);
    });
  });

  it("asks the conversation's own provider first when several are signed in", async () => {
    await withTestHarness({}, async (harness) => {
      const codex = registerFakeAiService(harness.deps.aiServices, {
        id: "codex",
        pluginId: "provider-codex",
        builtin: true,
        complete: async () => "From Codex",
      });
      const claude = registerClaudeCode(harness, {
        ready: () => true,
        title: "From Claude",
      });

      const forCodex = await runTextAiTask(harness.deps, {
        task: "thread-title",
        label: "test",
        prompt: "title",
        preferServiceId: "codex",
      });
      expect(forCodex).toMatchObject({ ok: true, value: "From Codex" });
      expect(claude.completeCalls).toEqual([]);

      const forClaude = await runTextAiTask(harness.deps, {
        task: "thread-title",
        label: "test",
        prompt: "title",
        preferServiceId: "claude-code",
      });
      expect(forClaude).toMatchObject({ ok: true, value: "From Claude" });
      expect(codex.completeCalls).toHaveLength(1);
    });
  });

  it("retries the title after a finished turn once a provider is signed in", async () => {
    await withTestHarness({}, async (harness) => {
      let clock = 0;
      let signedIn = false;
      const deps = {
        ...harness.deps,
        aiServices: createAiServiceRegistry({ now: () => clock }),
      };
      const scoped = { ...harness, deps } as TestAppHarness;
      registerCodexSignedOut(scoped);
      registerClaudeCode(scoped, { ready: () => signedIn });
      const thread = seedUntitledThread(scoped, "claude-code");

      const first = await generateThreadMetadataWithOutcome(deps, {
        input: INPUT,
        threadId: thread.id,
      });
      expect(first).toMatchObject({
        metadata: null,
        reason: "inference-unavailable",
      });
      noteTitleOutcome(deps, { threadId: thread.id, input: INPUT }, first);
      expect(hasTitleRetry(thread.id)).toBe(true);

      signedIn = true;
      clock += 10_001;
      await runQueuedTitleRetry(thread.id);

      expect(getThread(deps.db, thread.id)?.title).toBe(
        "Lisbon Trip in March",
      );
      expect(hasTitleRetry(thread.id)).toBe(false);
    });
  });

  it("stops retrying after a few finished turns when nothing is signed in", async () => {
    await withTestHarness({}, async (harness) => {
      registerCodexSignedOut(harness);
      const thread = seedUntitledThread(harness, "codex");
      const outcome = await generateThreadMetadataWithOutcome(harness.deps, {
        input: INPUT,
        threadId: thread.id,
      });
      noteTitleOutcome(
        harness.deps,
        { threadId: thread.id, input: INPUT },
        outcome,
      );

      for (let attempt = 1; attempt <= MAX_TITLE_RETRIES; attempt += 1) {
        expect(hasTitleRetry(thread.id)).toBe(true);
        await runQueuedTitleRetry(thread.id);
      }
      expect(hasTitleRetry(thread.id)).toBe(false);
      expect(getThread(harness.deps.db, thread.id)?.title).toBeNull();
    });
  });

  it("waits before a scheduled retry so a cached service status can expire", async () => {
    await withTestHarness({}, async (harness) => {
      let clock = 0;
      const deps = {
        ...harness.deps,
        aiServices: createAiServiceRegistry({ now: () => clock }),
      };
      const scoped = { ...harness, deps } as TestAppHarness;
      let signedIn = false;
      registerClaudeCode(scoped, { ready: () => signedIn });
      const thread = seedUntitledThread(scoped, "claude-code");
      const first = await generateThreadMetadataWithOutcome(deps, {
        input: INPUT,
        threadId: thread.id,
      });
      noteTitleOutcome(deps, { threadId: thread.id, input: INPUT }, first);
      signedIn = true;
      clock += 10_001;
      scheduleQueuedTitleRetry(thread.id, 5);
      expect(getThread(deps.db, thread.id)?.title).toBeNull();
      await vi.waitFor(() =>
        expect(getThread(deps.db, thread.id)?.title).toBe(
          "Lisbon Trip in March",
        ),
      );
    });
  });

  it("does not queue a retry for a message too short to title", async () => {
    await withTestHarness({}, async (harness) => {
      registerCodexSignedOut(harness);
      const thread = seedUntitledThread(harness, "codex");
      const shortInput = [
        promptInputSchema.parse({ type: "text", text: "hi there" }),
      ];
      const outcome = await generateThreadMetadataWithOutcome(harness.deps, {
        input: shortInput,
        threadId: thread.id,
      });
      noteTitleOutcome(
        harness.deps,
        { threadId: thread.id, input: shortInput },
        outcome,
      );
      expect(hasTitleRetry(thread.id)).toBe(false);
    });
  });

  it("puts a text-only service like Claude Code after Codex for tasks that name no provider", async () => {
    await withTestHarness({}, async (harness) => {
      const codex = registerFakeAiService(harness.deps.aiServices, {
        id: "codex",
        pluginId: "provider-codex",
        builtin: true,
        complete: async () => "From Codex",
      });
      const claude = registerClaudeCode(harness, { ready: () => true });
      await expect(
        runTextAiTask(harness.deps, {
          task: "commit-message",
          label: "test",
          prompt: "message",
        }),
      ).resolves.toMatchObject({ ok: true, value: "From Codex" });
      expect(codex.completeCalls).toHaveLength(1);
      expect(claude.completeCalls).toEqual([]);
    });
  });

  it("falls through to the next service when the conversation's own provider throws", async () => {
    await withTestHarness({}, async (harness) => {
      registerFakeAiService(harness.deps.aiServices, {
        id: "codex",
        pluginId: "provider-codex",
        builtin: true,
        complete: async () => {
          throw new Error("Codex is overloaded");
        },
      });
      const claude = registerClaudeCode(harness, { ready: () => true });
      const thread = seedUntitledThread(harness, "codex");
      const outcome = await generateThreadMetadataWithOutcome(harness.deps, {
        input: INPUT,
        threadId: thread.id,
      });
      expect(outcome.metadata).toEqual({ title: "Lisbon Trip in March" });
      expect(claude.completeCalls).toHaveLength(1);
    });
  });

  it("renames the provider thread when a retried title lands", async () => {
    await withTestHarness({}, async (harness) => {
      let clock = 0;
      let signedIn = false;
      const deps = {
        ...harness.deps,
        aiServices: createAiServiceRegistry({ now: () => clock }),
      };
      const scoped = { ...harness, deps } as TestAppHarness;
      registerClaudeCode(scoped, { ready: () => signedIn });
      const thread = seedUntitledThread(scoped, "codex", true);
      const first = await generateThreadMetadataWithOutcome(deps, {
        input: INPUT,
        threadId: thread.id,
      });
      noteTitleOutcome(deps, { threadId: thread.id, input: INPUT }, first);
      signedIn = true;
      clock += 10_001;
      await runQueuedTitleRetry(thread.id);

      const rename = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.rename" && command.threadId === thread.id,
      );
      expect(rename.command).toMatchObject({
        type: "thread.rename",
        threadId: thread.id,
        title: "Lisbon Trip in March",
      });
    });
  });
});
