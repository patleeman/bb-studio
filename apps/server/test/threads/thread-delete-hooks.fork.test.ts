import { getThread } from "@bb/db";
import { afterEach, describe, expect, it } from "vitest";
import { registerBeforeThreadDelete } from "../../src/services/threads/thread-delete-hooks.fork.js";
import { seedThread, seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

let dispose = () => {};
afterEach(() => dispose());

function seedIdleThread(harness: TestAppHarness) {
  const { project, environment } = seedThreadFixture(harness);
  return seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    status: "idle",
  });
}

function requestDelete(harness: TestAppHarness, threadId: string) {
  return harness.app.request(`/api/v1/threads/${threadId}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ childThreadsConfirmed: false }),
  });
}

describe("before-delete hook", () => {
  it("lets a plugin finish its work before the thread is deleted", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedIdleThread(harness);
      const seen: { threadId: string; stillThere: boolean }[] = [];
      dispose = registerBeforeThreadDelete("exporter", async ({ threadId }) => {
        await Promise.resolve();
        seen.push({
          threadId,
          stillThere: getThread(harness.db, threadId)?.deletedAt === null,
        });
      });

      const response = await requestDelete(harness, thread.id);

      expect(response.status).toBe(200);
      expect(seen).toEqual([{ threadId: thread.id, stillThere: true }]);
      expect(getThread(harness.db, thread.id)?.deletedAt).not.toBeNull();
    });
  });

  it("refuses the deletion when the plugin throws, and says why", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedIdleThread(harness);
      dispose = registerBeforeThreadDelete("exporter", () => {
        throw new Error("The export folder is not writable.");
      });

      const response = await requestDelete(harness, thread.id);

      expect(response.status).toBe(409);
      expect(((await response.json()) as { message: string }).message).toBe(
        "The exporter plugin stopped the deletion: The export folder is not writable.",
      );
      expect(getThread(harness.db, thread.id)?.deletedAt).toBeNull();
    });
  });
});
