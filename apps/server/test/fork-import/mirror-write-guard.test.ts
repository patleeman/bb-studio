import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MIRRORED_THREAD_MESSAGE,
  setForkImportDataDir,
} from "../../src/services/fork-import/index.js";
import {
  closeForkImportDatabases,
  openForkImportDatabase,
} from "../../src/services/fork-import/state.js";
import {
  ensureThreadIsWritable,
  sendThreadMessage,
} from "../../src/services/threads/thread-send.js";
import { readJson } from "../helpers/json.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const roots: string[] = [];

afterEach(async () => {
  setForkImportDataDir(null);
  closeForkImportDatabases();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function mirroredThread(harness: TestAppHarness) {
  const { host } = seedHostSession(harness.deps, { id: "host-mirror" });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: "/tmp/mirror-project",
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: "/tmp/mirror-environment",
    status: "ready",
  });
  const thread = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
    status: "idle",
  });
  const dataDir = await mkdtemp(join(tmpdir(), "bb-fork-mirror-guard-"));
  roots.push(dataDir);
  openForkImportDatabase(dataDir)
    .prepare(
      "INSERT INTO mirrored_threads (thread_id, source_updated_at, source_status, taken_over_at) VALUES (?, 1, 'idle', NULL)",
    )
    .run(thread.id);
  setForkImportDataDir(dataDir);
  return { dataDir, environment, thread };
}

const refusal = {
  code: "thread_read_only",
  message: MIRRORED_THREAD_MESSAGE,
  details: { reason: "mirrored" },
};

describe("mirrored threads are read-only", () => {
  it("refuses a send with the mirror message until the thread is taken over", async () => {
    await withTestHarness(async (harness) => {
      const { dataDir, environment, thread } = await mirroredThread(harness);

      await expect(
        sendThreadMessage(harness.deps, {
          originPluginId: null,
          environment,
          payload: {
            input: textInput("hello"),
            mode: "steer-if-active",
            model: "gpt-5",
            permissionMode: "full",
            reasoningLevel: "medium",
            serviceTier: "default",
          },
          thread,
          trigger: "user",
        }),
      ).rejects.toMatchObject({ status: 409, body: refusal });

      openForkImportDatabase(dataDir)
        .prepare("UPDATE mirrored_threads SET taken_over_at = 2")
        .run();
      expect(() => ensureThreadIsWritable(thread)).not.toThrow();
    });
  });

  it("refuses a queued message over the API with the same message", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = await mirroredThread(harness);

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/queued-messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ input: [{ type: "text", text: "later" }] }),
        },
      );

      expect(response.status).toBe(409);
      expect(await readJson(response)).toMatchObject(refusal);
    });
  });

  it("leaves threads writable when nothing was imported", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = await mirroredThread(harness);
      setForkImportDataDir(null);
      expect(() => ensureThreadIsWritable(thread)).not.toThrow();
    });
  });
});
