import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  bringOverJobFinished,
  startBringOverJob,
} from "../../src/services/fork-import/bring-over/job.js";
import { takeSourceSnapshot } from "../../src/services/fork-import/bring-over/source.js";
import { runThreadLifecycleSweep } from "../../src/services/system/periodic-sweeps.js";
import {
  seedEnvironment,
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";
import { runThreadPurges } from "../helpers/thread-purges.js";

const API = "/api/v1";
const logger = { info: () => {}, warn: () => {} };
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

/** A bb with one project and a thread in a bb worktree; the project's folder is `folder`. */
async function bbWithWorktreeThread(folder: string) {
  const root = await mkdtemp(join(tmpdir(), "bb-brought-over-"));
  roots.push(root);
  const source = join(root, ".bb");
  await mkdir(source, { recursive: true });
  const ids = { thread: "", project: "" };
  await withTestHarness(async (h) => {
    const { host } = seedHostSession(h.deps, { id: "host_bb" });
    const { project } = seedProjectWithSource(h.deps, {
      hostId: host.id,
      name: "repo",
      path: folder,
    });
    const environment = seedEnvironment(h.deps, {
      hostId: host.id,
      projectId: project.id,
      path: join(
        source,
        "plugins",
        "environment-git-worktree",
        "host-data",
        "worktrees",
        "k1",
        "repo",
      ),
    });
    h.db.$client
      .prepare(
        "UPDATE environments SET is_worktree = 1, provider_owns_path = 1, environment_provider_id = 'git-worktree', environment_provider_plugin_id = 'environment-git-worktree' WHERE id = ?",
      )
      .run(environment.id);
    const thread = seedThread(h.deps, {
      projectId: project.id,
      environmentId: environment.id,
      title: "Worktree thread",
      status: "idle",
    });
    ids.thread = thread.id;
    ids.project = project.id;
    await h.db.$client.backup(join(source, "bb.db"));
  });
  await writeFile(join(source, "host-id"), "host_bb\n");
  return { root, source, ids };
}

async function bringOver(h: TestAppHarness, source: string, threadId: string) {
  const here = seedHostSession(h.deps, { id: "host_here" }).host;
  seedPrimaryHost(h.deps, here.id);
  await writeFile(join(h.config.dataDir, "host-id"), "host_here\n");
  const snapshot = await takeSourceSnapshot({
    dataDir: h.config.dataDir,
    sourceDataDir: source,
    now: 1,
  });
  startBringOverJob({
    dataDir: h.config.dataDir,
    snapshot,
    target: h.db.$client as unknown as Database.Database,
    request: {
      picks: [{ kind: "thread", id: threadId }],
      attachments: true,
      settings: [],
    },
    logger,
    now: 2,
  });
  await bringOverJobFinished(h.config.dataDir);
}

const environmentOf = (h: TestAppHarness, threadId: string) =>
  (
    h.db.$client
      .prepare("SELECT environment_id FROM threads WHERE id = ?")
      .get(threadId) as { environment_id: string | null } | undefined
  )?.environment_id;

async function archiveUnarchiveDelete(h: TestAppHarness, threadId: string) {
  const archived = await h.app.request(
    `${API}/threads/${threadId}/archive-all`,
    {
      method: "POST",
    },
  );
  expect(archived.status).toBe(200);
  expect(await archived.json()).toEqual({
    ok: true,
    archivedThreadIds: [threadId],
  });
  const unarchived = await h.app.request(
    `${API}/threads/${threadId}/unarchive`,
    {
      method: "POST",
    },
  );
  expect(unarchived.status).toBe(200);
  const deleted = await h.app.request(`${API}/threads/${threadId}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ childThreadsConfirmed: false }),
  });
  expect(deleted.status).toBe(200);
  const row = h.db.$client
    .prepare("SELECT deleted_at FROM threads WHERE id = ?")
    .get(threadId) as { deleted_at: number | null } | undefined;
  if (row !== undefined) expect(row.deleted_at).not.toBeNull();
  await runThreadLifecycleSweep(h.deps);
  await runThreadPurges(h.deps);
}

describe("a thread brought over from bb", () => {
  it("archives, unarchives and deletes with no workspace on this Mac", async () => {
    const bb = await bbWithWorktreeThread("/nonexistent/bring-over/repo");
    await withTestHarness(async (h) => {
      await bringOver(h, bb.source, bb.ids.thread);
      expect(environmentOf(h, bb.ids.thread)).toBeNull();

      await archiveUnarchiveDelete(h, bb.ids.thread);

      expect(environmentOf(h, bb.ids.thread)).toBeUndefined();
    });
  });

  it("archives, unarchives and deletes in the project's folder, and leaves the folder alone", async () => {
    const root = await mkdtemp(join(tmpdir(), "bb-brought-over-folder-"));
    roots.push(root);
    const folder = join(root, "repo");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "work.txt"), "mine");
    const bb = await bbWithWorktreeThread(folder);
    await withTestHarness(async (h) => {
      await bringOver(h, bb.source, bb.ids.thread);
      const environmentId = environmentOf(h, bb.ids.thread);
      expect(environmentId).not.toBeNull();
      const thread = await h.app.request(`${API}/threads/${bb.ids.thread}`);
      expect(
        ((await thread.json()) as { environmentId: string }).environmentId,
      ).toBe(environmentId);

      await archiveUnarchiveDelete(h, bb.ids.thread);

      expect(existsSync(join(folder, "work.txt"))).toBe(true);
    });
  });
});
