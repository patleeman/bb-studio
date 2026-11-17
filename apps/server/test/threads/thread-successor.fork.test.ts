import { eq } from "drizzle-orm";
import { threadPluginMetadata, threads } from "@bb/db";
import { describe, expect, it } from "vitest";
import {
  findLiveSuccessor,
  type NextHandoff,
} from "../../src/services/threads/thread-successor.fork.js";
import { ensureThreadIsWritable } from "../../src/services/threads/thread-send.js";
import { readJson } from "../helpers/json.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function seedProject(harness: TestAppHarness, path: string) {
  const { host } = seedHostSession(harness.deps);
  return seedProjectWithSource(harness.deps, { hostId: host.id, path }).project;
}

function archive(harness: TestAppHarness, threadId: string) {
  harness.deps.db
    .update(threads)
    .set({ archivedAt: Date.now() })
    .where(eq(threads.id, threadId))
    .run();
}

function handOff(
  harness: TestAppHarness,
  args: { from: string; projectId: string; title: string; pluginId?: string },
) {
  const next = seedThread(harness.deps, {
    projectId: args.projectId,
    title: args.title,
  });
  harness.deps.db
    .insert(threadPluginMetadata)
    .values({
      threadId: next.id,
      pluginId: args.pluginId ?? "studio",
      metadataJson: JSON.stringify({
        role: "project-lead",
        handoffFrom: args.from,
      }),
    })
    .run();
  archive(harness, args.from);
  return next;
}

async function tell(harness: TestAppHarness, threadId: string) {
  const response = await harness.app.request(
    `/api/v1/threads/${threadId}/send`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: [{ type: "text", text: "hello" }],
        mode: "steer-if-active",
      }),
    },
  );
  return { status: response.status, body: await readJson(response) };
}

describe("a send to an archived thread", () => {
  it("names the live thread at the end of its handoff chain", async () => {
    await withTestHarness(async (harness) => {
      const project = seedProject(harness, "/tmp/successor-chain");
      const first = seedThread(harness.deps, { projectId: project.id });
      const second = handOff(harness, {
        from: first.id,
        projectId: project.id,
        title: "Lead (v2)",
      });
      const third = handOff(harness, {
        from: second.id,
        projectId: project.id,
        title: "Lead (v3)",
        pluginId: "another-plugin",
      });

      const result = await tell(harness, first.id);

      expect(result).toMatchObject({
        status: 409,
        body: {
          code: "thread_not_writable",
          message: `Thread is archived. It continues in thread ${third.id}.`,
          details: {
            reason: "archived",
            successorThreadId: third.id,
            successorTitle: "Lead (v3)",
          },
        },
      });
    });
  });

  it("keeps the plain refusal when nothing continues it", async () => {
    await withTestHarness(async (harness) => {
      const project = seedProject(harness, "/tmp/successor-none");
      const thread = seedThread(harness.deps, { projectId: project.id });
      archive(harness, thread.id);

      const result = await tell(harness, thread.id);

      expect(result.status).toBe(409);
      expect(result.body).toMatchObject({
        code: "thread_not_writable",
        message: "Thread is archived",
        details: { reason: "archived" },
      });
      expect(result.body).not.toHaveProperty("details.successorThreadId");
    });
  });

  it("skips deleted successors and threads in other projects", async () => {
    await withTestHarness(async (harness) => {
      const project = seedProject(harness, "/tmp/successor-scope");
      const other = seedProject(harness, "/tmp/successor-other");
      const thread = seedThread(harness.deps, { projectId: project.id });
      const deleted = handOff(harness, {
        from: thread.id,
        projectId: project.id,
        title: "Deleted",
      });
      harness.deps.db
        .update(threads)
        .set({ deletedAt: Date.now() })
        .where(eq(threads.id, deleted.id))
        .run();
      handOff(harness, {
        from: thread.id,
        projectId: other.id,
        title: "Elsewhere",
      });
      const archived = harness.deps.db
        .select()
        .from(threads)
        .where(eq(threads.id, thread.id))
        .get();

      expect(() =>
        ensureThreadIsWritable({ ...thread, archivedAt: archived!.archivedAt }),
      ).toThrow(
        expect.objectContaining({
          status: 409,
          body: expect.objectContaining({ message: "Thread is archived" }),
        }),
      );
    });
  });
});

describe("findLiveSuccessor", () => {
  const row = (id: string, archived: boolean) => ({
    id,
    title: null,
    title_fallback: `Fallback ${id}`,
    archived_at: archived ? 1 : null,
  });

  it("stops on a handoff cycle", () => {
    const next: NextHandoff = (_projectId, threadId) =>
      threadId === "a" ? row("b", true) : row("a", true);
    expect(findLiveSuccessor({ id: "a", projectId: "p" }, next)).toBeNull();
  });

  it("falls back to the thread's fallback title", () => {
    const next: NextHandoff = () => row("b", false);
    expect(findLiveSuccessor({ id: "a", projectId: "p" }, next)).toEqual({
      threadId: "b",
      title: "Fallback b",
    });
  });
});
